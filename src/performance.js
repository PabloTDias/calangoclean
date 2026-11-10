// Gerenciamento explícito de processos e LaunchAgents do usuário. Não há polling,
// comandos de shell, alteração de plists ou importação pelo agendamento.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const FIELDS = 'pid=,ppid=,uid=,ruid=,svuid=,pcpu=,rss=,etime=,lstart=,time=,comm=';
const SYSTEM_NAMES = new Set(['launchd', 'WindowServer', 'kernel_task', 'Finder', 'Dock', 'loginwindow', 'SystemUIServer', 'runningboardd', 'securityd', 'cfprefsd', 'launchservicesd']);
const SELF_LABEL = 'com.sejacalango.calangoclean';
const within = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const problem = (code, message) => Object.assign(new Error(message), { code });
const failure = (code, error) => ({ ok: false, code, error });
const validPid = pid => Number.isSafeInteger(pid) && pid > 1 && pid <= 2147483647;
const validLabel = label => typeof label === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(label);
const validPath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value) && path.resolve(value) === value;
const statIdentity = stat => [stat.dev, stat.ino, stat.uid, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const processIdentity = item => JSON.stringify([item.pid, item.ppid, item.uid, item.ruid, item.svuid, item.executable, item.started]);
const appBundle = item => item.executable.match(/^(.*?\.app)(?:\/|$)/i)?.[1];

function elapsed(value) {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!match || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

function cpuTime(value) {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match || Number(match[4]) >= 60 || (match[2] && Number(match[3]) >= 60)) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  return Number.isFinite(seconds) ? seconds : null;
}

function parseProcesses(text) {
  if (typeof text !== 'string') throw problem('PROCESS_UNAVAILABLE', 'Não foi possível ler os processos.');
  const result = [];
  const seen = new Set();
  for (const line of text.split('\n').filter(line => line.trim())) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+?)\s*$/);
    if (!match) throw problem('PROCESS_UNAVAILABLE', 'A resposta do macOS sobre os processos não pôde ser validada.');
    const [pid, ppid, uid, ruid, svuid, cpu, rss] = match.slice(1, 8).map(Number);
    const elapsedSeconds = elapsed(match[8]);
    const cpuSeconds = cpuTime(match[10]);
    if (seen.has(pid) || !Number.isSafeInteger(pid) || pid < 0 || !Number.isSafeInteger(rss * 1024) || elapsedSeconds === null || cpuSeconds === null || !Number.isFinite(Date.parse(match[9]))) {
      throw problem('PROCESS_UNAVAILABLE', 'A resposta do macOS sobre os processos não pôde ser validada.');
    }
    seen.add(pid);
    const executable = match[11];
    const bundle = executable.match(/\/([^/]+)\.app(?:\/|$)/i);
    result.push({ pid, ppid, uid, ruid, svuid, cpu, cpuSeconds, memoryBytes: rss * 1024, elapsedSeconds,
      executable, started: match[9].replace(/\s+/g, ' '), name: (bundle ? bundle[1] : path.basename(executable)).slice(0, 180) });
  }
  if (!result.length) throw problem('PROCESS_UNAVAILABLE', 'O macOS não retornou uma lista de processos.');
  return result;
}

function create(options = {}) {
  const fileSystem = options.fs || fs;
  const run = options.run || promisify(options.execFile || execFile);
  const signal = options.kill || ((pid, name) => process.kill(pid, name));
  const uid = options.uid ?? process.getuid();
  const selfPid = options.selfPid ?? process.pid;
  const selfPath = path.resolve(options.selfPath || path.join(__dirname, '..'));
  const selfBundle = selfPath.match(/^(.*?\.app)(?:\/|$)/i)?.[1] || selfPath;
  const home = path.resolve(options.home || os.homedir());
  const agentsDir = path.join(home, 'Library', 'LaunchAgents');
  const domain = `gui/${uid}`;
  const now = options.now || Date.now;
  const getCpus = options.getCpus || (() => os.cpus());
  const getMemoryInfo = options.getMemoryInfo || (() => ({ total: os.totalmem(), free: os.freemem() }));
  const waitForCpuSample = options.waitForCpuSample || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const ttl = options.tokenTtlMs ?? 2 * 60 * 1000;
  const tokens = new Map();
  const terminated = new Map();
  let processGroups = new Map();
  let cpuSamples = new Map();
  let services = new Map();
  let listing = null;
  let sampling = null;
  let pressureSample = null;
  let pressureAt = -Infinity;
  let busy = false;

  const command = (file, args) => run(file, args, { timeout: 10000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  async function readProcesses() {
    const { stdout } = await command('/bin/ps', ['-ax', '-ww', '-o', FIELDS]);
    return parseProcesses(stdout);
  }

  function protectedPids(rows) {
    const map = new Map(rows.map(row => [row.pid, row]));
    const protectedSet = new Set([selfPid]);
    let current = map.get(selfPid);
    if (!current) return null; // Sem a árvore do próprio app, não autoriza sinais.
    while (current && current.ppid > 0 && !protectedSet.has(current.ppid)) {
      protectedSet.add(current.ppid);
      current = map.get(current.ppid);
    }
    // Inclui helpers/filhos, mesmo quando o nome não contém CalangoClean.
    const descendants = new Set([selfPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
          descendants.add(row.pid); protectedSet.add(row.pid); changed = true;
        }
      }
    }
    return protectedSet;
  }

  function blocked(item, rows, { service = false, protectedSet = protectedPids(rows) } = {}) {
    if (!validPid(item.pid) || uid === 0 || item.uid !== uid || item.ruid !== uid || item.svuid !== uid) return 'Processo do sistema ou de outro usuário.';
    if (!protectedSet) return 'Não foi possível verificar a proteção do próprio aplicativo.';
    if (protectedSet.has(item.pid) || within(item.executable, selfBundle) || /(?:^|\/)CalangoClean(?: Helper[^/]*)?(?:\.app|\/|$)/i.test(item.executable)) return 'O CalangoClean e os processos necessários para executá-lo são protegidos.';
    if (!validPath(item.executable)) return 'O caminho deste processo não pôde ser validado.';
    if (SYSTEM_NAMES.has(path.basename(item.executable))) return 'Processo protegido do macOS.';
    if (!service && ['/System', '/Library', '/private', '/usr', '/bin', '/sbin'].some(root => within(item.executable, root))) return 'Processo protegido do macOS.';
    return null;
  }

  function publicProcess(item, rows, protectedSet) {
    const blockedReason = blocked(item, rows, { protectedSet });
    const prior = terminated.get(item.pid);
    const canForce = !blockedReason && !!prior && prior.identity === processIdentity(item) && now() - prior.at <= ttl;
    return { pid: item.pid, name: item.name, cpu: item.cpu, memoryBytes: item.memoryBytes,
      elapsedSeconds: item.elapsedSeconds, canTerminate: !blockedReason, canForce, blockedReason };
  }

  async function publishProcesses(rows) {
    const at = now();
    const nextSamples = new Map();
    const grouped = new Map();
    const protectedSet = protectedPids(rows);
    for (const item of rows) {
      const identity = processIdentity(item);
      const previous = cpuSamples.get(item.pid);
      const seconds = previous && previous.identity === identity ? (at - previous.at) / 1000 : 0;
      const delta = previous ? item.cpuSeconds - previous.cpuSeconds : -1;
      const result = publicProcess(item, rows, protectedSet);
      if (seconds > 0 && delta >= 0) result.cpu = delta / seconds * 100;
      nextSamples.set(item.pid, { at, identity, cpuSeconds: item.cpuSeconds });
      const bundle = appBundle(item);
      // Protected processes never lend their identity or permissions to an app group.
      const key = bundle && !result.blockedReason ? `app:${item.uid}:${bundle}` : `process:${identity}`;
      if (!grouped.has(key)) grouped.set(key, { key, bundle, members: [], values: [] });
      grouped.get(key).members.push(item);
      grouped.get(key).values.push(result);
    }
    const nextGroups = new Map();
    const publicRows = await Promise.all([...grouped.values()].map(async group => {
      group.members.sort((a, b) => {
        const primary = item => group.bundle && path.dirname(item.executable) === path.join(group.bundle, 'Contents', 'MacOS');
        return Number(primary(b)) - Number(primary(a)) || b.elapsedSeconds - a.elapsedSeconds || a.pid - b.pid;
      });
      const representative = group.members[0];
      const result = { ...group.values.find(item => item.pid === representative.pid),
        id: crypto.createHash('sha256').update(group.key).digest('hex').slice(0, 24),
        pids: group.members.map(item => item.pid).sort((a, b) => a - b),
        processCount: group.members.length, isAppGroup: group.key.startsWith('app:'),
        cpu: group.values.reduce((total, item) => total + item.cpu, 0),
        memoryBytes: group.values.reduce((total, item) => total + item.memoryBytes, 0),
        elapsedSeconds: Math.max(...group.values.map(item => item.elapsedSeconds)),
        canForce: group.values.every(item => item.canForce) };
      nextGroups.set(representative.pid, group.members);
      if (group.bundle && options.getIcon) {
        try { result.icon = await options.getIcon(group.bundle); } catch { result.icon = null; }
      }
      return result;
    }));
    processGroups = nextGroups;
    cpuSamples = nextSamples;
    return publicRows.sort((a, b) => b.cpu - a.cpu || b.memoryBytes - a.memoryBytes);
  }

  async function pressure() {
    if (pressureSample && now() - pressureAt < 5000) return pressureSample;
    const results = await Promise.allSettled([
      command('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']),
      command('/usr/bin/memory_pressure', ['-Q']), // Apenas consulta; jamais usa -l/-p/-S.
    ]);
    // O sysctl exporta os flags de dispatch (1/2/4), não o enum interno 0/1/2/3.
    // Apple XNU: bsd/kern/kern_memorystatus_notify.c, sysctl_memorystatus_vm_pressure_level.
    const level = results[0].status === 'fulfilled' ? ({ 1: 'normal', 2: 'warning', 4: 'critical' }[results[0].value.stdout.trim()] || 'unknown') : 'unknown';
    const match = results[1].status === 'fulfilled' ? results[1].value.stdout.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/) : null;
    const percent = match ? Number(match[1]) : null;
    pressureSample = { level, freePercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null };
    pressureAt = now();
    return pressureSample;
  }

  async function systemMetrics() {
    const result = { cpuPercent: null, memoryUsedBytes: null, memoryTotalBytes: null };
    // Physical occupancy includes caches; memory pressure remains the macOS health signal.
    try {
      const memory = getMemoryInfo();
      if (Number.isSafeInteger(memory?.total) && memory.total > 0 && Number.isSafeInteger(memory.free) && memory.free >= 0 && memory.free <= memory.total) {
        result.memoryTotalBytes = memory.total;
        result.memoryUsedBytes = memory.total - memory.free;
      }
    } catch { /* Memory and CPU remain independently available. */ }
    try {
      const keys = ['user', 'nice', 'sys', 'idle', 'irq'];
      const snapshot = () => {
        const cpus = getCpus();
        if (!Array.isArray(cpus) || !cpus.length) throw new Error('CPU unavailable');
        return cpus.map(cpu => keys.map(key => {
          const value = cpu?.times?.[key];
          if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid CPU counter');
          return value;
        }));
      };
      const before = snapshot();
      // One bounded sample belongs to this request, with no background timer here.
      await waitForCpuSample(200);
      const after = snapshot();
      if (before.length !== after.length) return result;
      let total = 0;
      let idle = 0;
      for (let core = 0; core < before.length; core++) {
        for (let key = 0; key < keys.length; key++) {
          const delta = after[core][key] - before[core][key];
          if (delta < 0) return result;
          total += delta;
          if (keys[key] === 'idle') idle += delta;
        }
      }
      if (Number.isSafeInteger(total) && total > 0) result.cpuPercent = (total - idle) / total * 100;
    } catch { /* Do not manufacture zero usage when sampling fails. */ }
    return result;
  }

  async function sampleMetrics(rows) {
    const [system, memoryPressure, processState] = await Promise.all([
      systemMetrics(), pressure(),
      (rows ? Promise.resolve(rows) : readProcesses()).then(publishProcesses).then(processes => ({ processes })).catch(() => ({
        processError: 'Não foi possível atualizar os aplicativos. A lista mantém a última leitura.',
      })),
    ]);
    return { ok: true, systemMetrics: system, memoryPressure, ...processState,
      pressureError: memoryPressure.level === 'unknown' ? 'A pressão de memória não está disponível neste macOS.' : undefined,
      sampledAt: new Date(now()).toISOString() };
  }

  function metrics() {
    // A manual refresh owns the newer snapshot; do not race it with another ps.
    if (listing) return listing.then(({ services, serviceError, ...result }) => result);
    if (sampling) return sampling;
    // Refreshing telemetry does not invalidate consent tokens or reread services.
    sampling = sampleMetrics().catch(errorResult).finally(() => { sampling = null; });
    return sampling;
  }

  async function agentRoot() {
    const stat = await fileSystem.lstat(agentsDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o022 || await fileSystem.realpath(agentsDir) !== agentsDir) throw problem('UNSAFE_AGENT', 'A pasta de LaunchAgents não pôde ser validada.');
    return `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}`;
  }

  async function inspectPlist(file) {
    if (path.dirname(file) !== agentsDir || !file.endsWith('.plist') || !validPath(file)) throw problem('UNSAFE_AGENT', 'LaunchAgent fora da pasta permitida.');
    const root = await agentRoot();
    const before = await fileSystem.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid || before.mode & 0o022 || before.size > 1024 * 1024) throw problem('UNSAFE_AGENT', 'Este LaunchAgent não pode ser validado com segurança.');
    const bytes = await fileSystem.readFile(file);
    const plist = options.readPlist ? await options.readPlist(file) : JSON.parse((await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])).stdout);
    const after = await fileSystem.lstat(file);
    if (statIdentity(before) !== statIdentity(after) || root !== await agentRoot()) throw problem('CHANGED', 'O LaunchAgent mudou. Atualize a lista e revise novamente.');
    if (!plist || typeof plist !== 'object' || !validLabel(plist.Label)) throw problem('UNSAFE_AGENT', 'O identificador deste LaunchAgent é inválido.');
    const program = plist.Program || plist.ProgramArguments?.[0];
    if (!validPath(program)) throw problem('UNSAFE_AGENT', 'O executável deste LaunchAgent não pôde ser validado.');
    const signature = crypto.createHash('sha256').update(bytes).digest('hex');
    return { file, root, identity: statIdentity(after), signature, label: plist.Label, program };
  }

  async function jobFor(plist) {
    let output;
    try { output = (await command('/bin/launchctl', ['print', `${domain}/${plist.label}`])).stdout; }
    catch (error) {
      if (error.code === 113 || error.code === 3 || /Could not find service|Could not find specified service/i.test(error.stderr || '')) return null;
      throw problem('SERVICE_UNAVAILABLE', 'Não foi possível verificar os serviços da sua sessão.');
    }
    // print é uma saída diagnóstica variável do macOS. Exige a forma conhecida;
    // versões diferentes ficam sem ação em vez de presumir a origem de um job.
    if (typeof output !== 'string' || !output.startsWith(`${domain}/${plist.label} = {`)) throw problem('SERVICE_UNAVAILABLE', 'O macOS retornou um serviço que não pôde ser validado.');
    const fields = {};
    for (const line of output.split('\n')) {
      const match = line.match(/^\t([^\s=]+) = (.*?)\s*$/);
      if (match && ['path', 'state', 'pid', 'program'].includes(match[1])) {
        if (match[1] in fields) throw problem('SERVICE_UNAVAILABLE', 'A identidade do serviço é ambígua.');
        fields[match[1]] = match[2];
      }
    }
    if (fields.path !== plist.file || fields.program !== plist.program) throw problem('CHANGED', 'O serviço carregado tem outra origem. Ele foi preservado.');
    if (fields.state !== 'running' || !validPid(Number(fields.pid))) return null;
    return { pid: Number(fields.pid), signature: JSON.stringify([plist.label, fields.path, fields.program, Number(fields.pid)]) };
  }

  function serviceBlocked(plist, item, rows) {
    if (plist.label.startsWith('com.apple.') || plist.label === SELF_LABEL || plist.label.startsWith(`${SELF_LABEL}.`)) return 'Serviço da Apple ou do CalangoClean protegido.';
    if (within(plist.program, selfBundle)) return 'Serviço do próprio CalangoClean protegido.';
    return blocked(item, rows, { service: true });
  }

  async function readServices(rows) {
    const result = new Map();
    try { await agentRoot(); }
    catch (error) { if (error.code === 'ENOENT') return { result }; throw error; }
    let partial = false;
    const names = (await fileSystem.readdir(agentsDir)).filter(name => name.endsWith('.plist')).sort();
    if (names.length > 300) throw problem('SERVICE_UNAVAILABLE', 'Há LaunchAgents demais para uma revisão segura.');
    for (const name of names) {
      try {
        const plist = await inspectPlist(path.join(agentsDir, name));
        const job = await jobFor(plist);
        if (!job) continue;
        const item = rows.find(row => row.pid === job.pid);
        if (!item) { partial = true; continue; }
        const id = crypto.randomUUID();
        result.set(id, { ...plist, pid: job.pid, signatureJob: job.signature, id, processIdentity: processIdentity(item), blockedReason: serviceBlocked(plist, item, rows) });
      } catch { partial = true; }
    }
    return { result, serviceError: partial ? 'Alguns LaunchAgents não puderam ser validados e foram preservados.' : undefined };
  }

  function errorResult(error) {
    if (['PROCESS_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'UNSAFE_AGENT', 'CHANGED', 'PROTECTED', 'FORCE_NOT_ALLOWED', 'NOT_FOUND'].includes(error?.code)) return failure(error.code, error.message);
    if (error?.code === 'ESRCH') return failure('NOT_FOUND', 'O processo já foi encerrado. Atualize a lista.');
    if (error?.code === 'EPERM' || error?.code === 'EACCES') return failure(error.code, 'O macOS não permitiu a operação. Nenhuma elevação de privilégios foi tentada.');
    return failure('UNAVAILABLE', 'Não foi possível concluir a operação com segurança. Atualize a lista e tente novamente.');
  }

  async function list() {
    if (busy) return failure('BUSY', 'Uma operação já está em andamento.');
    if (listing) return listing;
    const pendingSample = sampling;
    tokens.clear();
    listing = (async () => {
      if (pendingSample) await pendingSample;
      processGroups.clear(); services.clear();
      const rows = await readProcesses();
      const [metricState, serviceState] = await Promise.all([
        sampleMetrics(rows), readServices(rows).catch(() => ({ result: new Map(), serviceError: 'Não foi possível ler os LaunchAgents da sua sessão.' })),
      ]);
      if (!metricState.ok) throw problem('UNAVAILABLE', metricState.error);
      services = serviceState.result;
      return { ...metricState,
        services: [...services.values()].map(item => ({ id: item.id, label: item.label, pid: item.pid, canUnload: !item.blockedReason, blockedReason: item.blockedReason })),
        serviceError: serviceState.serviceError };
    })().catch(errorResult).finally(() => { listing = null; });
    return listing;
  }

  async function currentGroup(expected) {
    const rows = await readProcesses();
    const current = new Map(rows.map(item => [item.pid, item]));
    return expected.map(previous => {
      const item = current.get(previous.pid);
      if (!item) throw problem('NOT_FOUND', 'Um dos processos já foi encerrado. Atualize a lista.');
      if (processIdentity(item) !== processIdentity(previous)) throw problem('CHANGED', 'Um dos processos mudou de identidade. Atualize a lista e revise novamente.');
      const reason = blocked(item, rows);
      if (reason) throw problem('PROTECTED', reason);
      return item;
    });
  }

  function requireNormalAttempt(items) {
    for (const item of items) {
      const prior = terminated.get(item.pid);
      if (!prior || prior.identity !== processIdentity(item) || now() - prior.at > ttl) throw problem('FORCE_NOT_ALLOWED', 'Peça para encerrar normalmente antes de forçar o encerramento.');
    }
  }

  function issue(kind, target, snapshot, mode, extra = {}) {
    if (typeof mode !== 'boolean') throw problem('CHANGED', 'O modo de simulação não pôde ser validado.');
    const token = crypto.randomUUID();
    // Uma nova revisão substitui revisões anteriores do mesmo alvo.
    for (const [key, value] of tokens) if (value.kind === kind && value.target === target) tokens.delete(key);
    tokens.set(token, { kind, target, snapshot, dryRun: mode, expires: now() + ttl, ...extra });
    return token;
  }

  function consume(request, kind, key, dryRun) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw problem('CHANGED', 'Confirmação inválida. Revise novamente.');
    const entry = tokens.get(request.token);
    tokens.delete(request.token);
    if (!entry || entry.kind !== kind || entry.target !== request[key] || entry.expires <= now()) throw problem('CHANGED', 'A confirmação venceu ou já foi usada. Revise novamente.');
    if (typeof dryRun !== 'boolean' || typeof request.expectedDryRun !== 'boolean' || request.expectedDryRun !== dryRun || entry.dryRun !== dryRun) throw problem('CHANGED', 'O modo de simulação mudou. Revise novamente.');
    return entry;
  }

  async function prepareProcess(pid, { force = false, dryRun } = {}) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    try {
      if (!validPid(pid) || typeof force !== 'boolean') throw problem('NOT_FOUND', 'Selecione um processo da lista.');
      const expected = processGroups.get(pid);
      if (!expected) throw problem('NOT_FOUND', 'Atualize a lista antes de encerrar um processo.');
      const items = await currentGroup(expected);
      if (force) requireNormalAttempt(items);
      const token = issue('process', pid, items, dryRun, { force });
      return { ok: true, token, pid, name: items[0].name, pids: items.map(item => item.pid).sort((a, b) => a - b),
        processCount: items.length, isAppGroup: !!appBundle(items[0]), force, dryRun };
    } catch (error) { return errorResult(error); }
  }

  async function terminate(request, { dryRun } = {}) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    busy = true;
    try {
      const confirmation = consume(request, 'process', 'pid', dryRun);
      if (typeof request.force !== 'boolean' || request.force !== confirmation.force) throw problem('CHANGED', 'O tipo de encerramento mudou. Revise novamente.');
      const items = await currentGroup(confirmation.snapshot);
      if (confirmation.force) requireNormalAttempt(items);
      if (dryRun) return { ok: true, simulated: true, exited: false, canForce: false };
      // Every positive PID was reviewed and revalidated; never signal an OS process group.
      const signaled = [];
      for (const item of items) {
        try { signal(item.pid, confirmation.force ? 'SIGKILL' : 'SIGTERM'); }
        catch (error) {
          if (error.code === 'ESRCH') { terminated.delete(item.pid); continue; }
          if (!signaled.length) throw error;
          return { ok: true, simulated: false, exited: false, canForce: false,
            warning: 'Alguns processos receberam o sinal, mas o macOS impediu concluir o encerramento. Atualize a lista.' };
        }
        signaled.push(item);
        if (!confirmation.force) terminated.set(item.pid, { identity: processIdentity(item), at: now() });
        else terminated.delete(item.pid);
      }
      // Consulta única após o sinal, sem monitoramento ou espera em segundo plano.
      let remaining;
      let after;
      try {
        after = new Map((await readProcesses()).map(item => [item.pid, item]));
        remaining = items.filter(item => after.has(item.pid) && processIdentity(after.get(item.pid)) === processIdentity(item));
      }
      catch { return { ok: true, simulated: false, exited: false, canForce: false, warning: 'O sinal foi enviado, mas não foi possível confirmar se o processo encerrou. Atualize a lista.' }; }
      const remainingPids = new Set(remaining.map(item => item.pid));
      for (const item of items) if (!remainingPids.has(item.pid)) terminated.delete(item.pid);
      // Keep the just-shown action usable while the next telemetry cycle catches up.
      const activeSnapshot = (processGroups.get(request.pid) || items).filter(item => after.has(item.pid) && processIdentity(after.get(item.pid)) === processIdentity(item));
      if (activeSnapshot.length) processGroups.set(request.pid, activeSnapshot);
      else processGroups.delete(request.pid);
      const canForce = !!remaining.length && !confirmation.force && activeSnapshot.every(item => {
        const prior = terminated.get(item.pid);
        return prior && prior.identity === processIdentity(item) && now() - prior.at <= ttl;
      });
      return { ok: true, simulated: false, exited: !remaining.length, canForce };
    } catch (error) { return errorResult(error); }
    finally { busy = false; }
  }

  async function currentService(expected) {
    const plist = await inspectPlist(expected.file);
    if (plist.root !== expected.root || plist.identity !== expected.identity || plist.signature !== expected.signature || plist.label !== expected.label || plist.program !== expected.program) throw problem('CHANGED', 'O LaunchAgent mudou. Atualize a lista e revise novamente.');
    const job = await jobFor(plist);
    if (!job || job.signature !== expected.signatureJob || job.pid !== expected.pid) throw problem('CHANGED', 'O serviço foi encerrado ou reiniciado. Atualize a lista.');
    const rows = await readProcesses();
    const item = rows.find(row => row.pid === job.pid);
    if (!item || processIdentity(item) !== expected.processIdentity) throw problem('CHANGED', 'O processo do serviço mudou. Atualize a lista.');
    const reason = serviceBlocked(plist, item, rows);
    if (reason) throw problem('PROTECTED', reason);
    return { plist, job };
  }

  async function prepareService(id, { dryRun } = {}) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    try {
      const expected = services.get(id);
      if (!expected) throw problem('NOT_FOUND', 'Atualize a lista antes de descarregar um serviço.');
      await currentService(expected);
      const token = issue('service', id, expected, dryRun);
      return { ok: true, token, id, label: expected.label, dryRun };
    } catch (error) { return errorResult(error); }
  }

  async function unloadService(request, { dryRun } = {}) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    busy = true;
    try {
      const confirmation = consume(request, 'service', 'id', dryRun);
      const { plist } = await currentService(confirmation.snapshot);
      if (dryRun) return { ok: true, simulated: true };
      await command('/bin/launchctl', ['bootout', `${domain}/${plist.label}`]);
      services.delete(request.id);
      return { ok: true, simulated: false };
    } catch (error) { return errorResult(error); }
    finally { busy = false; }
  }

  return { list, metrics, prepareProcess, terminate, prepareService, unloadService };
}

module.exports = { create, parseProcesses };
