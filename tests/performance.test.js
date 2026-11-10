const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create, parseProcesses } = require('../src/performance');

// Sinais e launchctl são sempre doubles; nenhum teste encerra processos reais.
const UID = process.getuid();
function processRow(pid = 42, overrides = {}) {
  return { pid, ppid: 1, uid: UID, ruid: UID, svuid: UID, cpu: 17.3, rss: 2048,
    elapsed: '01:02:03', started: 'Sat Nov  7 20:28:23 2026', cpuTime: '00:10.00', executable: '/Applications/Example.app/Contents/MacOS/Example', ...overrides };
}
function output(rows) {
  return rows.map(row => ` ${row.pid} ${row.ppid} ${row.uid} ${row.ruid} ${row.svuid} ${row.cpu} ${row.rss} ${row.elapsed} ${row.started} ${row.cpuTime} ${row.executable}`).join('\n');
}
async function fixture(t, overrides = {}) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'calango-performance-')));
  const dir = path.join(home, 'Library', 'LaunchAgents');
  await fs.mkdir(dir, { recursive: true, mode: 0o755 });
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const state = { now: 100000, rows: [
    processRow(1, { uid: 0, ruid: 0, svuid: 0, ppid: 0, executable: '/sbin/launchd' }),
    processRow(1000, { executable: '/Applications/Terminal.app/Contents/MacOS/Terminal' }),
    processRow(9999, { ppid: 1000, executable: '/Applications/CalangoClean.app/Contents/MacOS/CalangoClean' }),
    processRow(),
  ], commands: [], signals: [], jobs: new Map(), killError: null, psError: false, onSignal: null, cpuReads: 0, memoryReads: 0, sampleWaits: [] };
  const options = { home, uid: UID, selfPid: 9999, selfPath: '/Applications/CalangoClean.app', now: () => state.now,
    getCpus: () => {
      const sample = state.cpuReads++;
      return [{ times: { user: sample * 25, nice: 0, sys: 0, idle: sample * 75, irq: 0 } }];
    },
    getMemoryInfo: () => { state.memoryReads++; return { total: 16 * 1024 ** 3, free: 4 * 1024 ** 3 }; },
    waitForCpuSample: async ms => { state.sampleWaits.push(ms); },
    run: async (command, args) => {
      state.commands.push({ command, args });
      if (command === '/bin/ps') {
        if (state.psError) throw Error('ps denied');
        return { stdout: output(state.rows) };
      }
      if (command === '/usr/sbin/sysctl') return { stdout: '1\n' };
      if (command === '/usr/bin/memory_pressure') { assert.deepEqual(args, ['-Q']); return { stdout: 'System-wide memory free percentage: 37%\n' }; }
      if (command === '/usr/bin/plutil') return { stdout: await fs.readFile(args.at(-1), 'utf8') };
      if (command === '/bin/launchctl') {
        const label = args[1].split('/').at(-1);
        const job = state.jobs.get(label);
        if (args[0] === 'print') {
          if (!job) throw Object.assign(Error('not loaded'), { code: 113 });
          return { stdout: `${args[1]} = {\n\tpath = ${job.file}\n\tstate = ${job.state || 'running'}\n\tprogram = ${job.program}\n\tpid = ${job.pid}\n}\n` };
        }
        if (args[0] === 'bootout') { assert.ok(job); state.jobs.delete(label); return { stdout: '' }; }
      }
      throw Error(`Unexpected command: ${command}`);
    },
    kill: (pid, signal) => {
      if (state.killError) throw state.killError;
      state.signals.push({ pid, signal });
      state.onSignal?.(pid, signal);
    }, ...overrides };
  const manager = create(options);
  async function agent(label = 'com.fixture.worker', config = {}) {
    const file = path.join(dir, `${label}.plist`);
    const pid = config.pid || 43;
    const program = config.program || path.join(home, 'worker');
    await fs.writeFile(file, JSON.stringify({ Label: label, ProgramArguments: [program] }), { mode: 0o644 });
    state.jobs.set(label, { file, program, pid, ...config });
    state.rows.push(processRow(pid, { executable: program }));
    return file;
  }
  async function processConsent(dryRun = false, force = false, pid = 42) {
    const prepared = await manager.prepareProcess(pid, { force, dryRun });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    return { pid, token: prepared.token, force, expectedDryRun: dryRun };
  }
  async function serviceConsent(id, dryRun = false) {
    const prepared = await manager.prepareService(id, { dryRun });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    return { id, token: prepared.token, expectedDryRun: dryRun };
  }
  return { manager, state, home, dir, options, agent, processConsent, serviceConsent };
}

test('interpreta ps do macOS com espaços no app, RSS em KiB e dias de execução', () => {
  const rows = parseProcesses(output([processRow(42, { elapsed: '2-03:04:05', executable: '/Applications/Meu App.app/Contents/MacOS/Meu App' })]));
  assert.equal(rows[0].name, 'Meu App');
  assert.equal(rows[0].memoryBytes, 2097152);
  assert.equal(rows[0].elapsedSeconds, 183845);
  assert.equal(rows[0].cpu, 17.3);
  assert.equal(rows[0].cpuSeconds, 10);
  assert.throws(() => parseProcesses('resposta inválida'));
  assert.throws(() => parseProcesses(output([processRow(), processRow()])));
});

test('lista métricas só por chamada, sem expor executáveis nem início ao renderer', async t => {
  const f = await fixture(t);
  assert.equal(f.state.commands.length, 0);
  assert.equal(f.state.cpuReads, 0);
  assert.equal(f.state.memoryReads, 0);
  const result = await f.manager.list();
  assert.equal(result.ok, true);
  assert.equal(result.processes.find(row => row.pid === 42).canTerminate, true);
  assert.deepEqual(result.memoryPressure, { level: 'normal', freePercent: 37 });
  assert.deepEqual(result.systemMetrics, { cpuPercent: 25, memoryUsedBytes: 12 * 1024 ** 3, memoryTotalBytes: 16 * 1024 ** 3 });
  assert.equal(f.state.cpuReads, 2);
  assert.equal(f.state.memoryReads, 1);
  assert.deepEqual(f.state.sampleWaits, [200]);
  assert.equal(JSON.stringify(result).includes('/Applications/'), false);
  assert.equal(f.state.signals.length, 0);
  assert.equal(f.state.commands.filter(call => call.command === '/bin/ps').length, 1);
});

test('consulta automática atualiza processos CPU RAM e pressão sem serviços ou sinais', async t => {
  let iconReads = 0;
  const f = await fixture(t, { getIcon: async () => { iconReads++; return null; } });
  await f.agent();
  const result = await f.manager.metrics();
  assert.equal(result.ok, true);
  assert.deepEqual(result.systemMetrics, { cpuPercent: 25, memoryUsedBytes: 12 * 1024 ** 3, memoryTotalBytes: 16 * 1024 ** 3 });
  assert.deepEqual(result.memoryPressure, { level: 'normal', freePercent: 37 });
  assert.equal(result.sampledAt, new Date(f.state.now).toISOString());
  assert.deepEqual(f.state.commands.map(call => call.command).sort(), ['/bin/ps', '/usr/bin/memory_pressure', '/usr/sbin/sysctl']);
  assert.equal(result.processes.find(row => row.pid === 42).name, 'Example');
  assert.equal(Object.hasOwn(result, 'services'), false);
  assert.equal(iconReads, 3);
  assert.deepEqual(f.state.signals, []);
});

test('consultas de métricas sobrepostas compartilham uma amostra e liberam a próxima', async t => {
  let release;
  const f = await fixture(t, { waitForCpuSample: () => new Promise(resolve => { release = resolve; }) });
  const first = f.manager.metrics();
  const second = f.manager.metrics();
  assert.equal(first, second);
  assert.equal(f.state.cpuReads, 1);
  release();
  assert.equal((await first).systemMetrics.cpuPercent, 25);
  assert.equal((await second).ok, true);
  assert.equal(f.state.cpuReads, 2);
  const third = f.manager.metrics();
  assert.notEqual(third, first);
  release();
  await third;
  assert.equal(f.state.cpuReads, 4);
  assert.equal(f.state.commands.length, 4, 'pressão é reutilizada enquanto processos e CPU continuam atualizando');
});

test('atualização manual aguarda telemetria pendente e novas métricas compartilham o snapshot manual', async t => {
  let release;
  let released = false;
  const barrier = new Promise(resolve => { release = () => { released = true; resolve(); }; });
  const f = await fixture(t, { getIcon: async () => { if (!released) await barrier; return null; } });
  const old = f.manager.metrics();
  await new Promise(setImmediate);
  const manual = f.manager.list();
  const joined = f.manager.metrics();
  assert.equal(f.state.commands.filter(call => call.command === '/bin/ps').length, 1);
  f.state.rows.find(item => item.pid === 42).rss = 8192;
  release();
  assert.equal((await old).processes.find(item => item.pid === 42).memoryBytes, 2 * 1024 ** 2);
  assert.equal((await manual).processes.find(item => item.pid === 42).memoryBytes, 8 * 1024 ** 2);
  const joinedResult = await joined;
  assert.equal(joinedResult.processes.find(item => item.pid === 42).memoryBytes, 8 * 1024 ** 2);
  assert.equal(Object.hasOwn(joinedResult, 'services'), false);
  assert.equal(f.state.commands.filter(call => call.command === '/bin/ps').length, 2);
});

test('métricas automáticas preservam confirmações de processo e serviço em revisão', async t => {
  const f = await fixture(t);
  await f.agent();
  const listed = await f.manager.list();
  const processRequest = await f.processConsent(true);
  const serviceRequest = await f.serviceConsent(listed.services[0].id, true);
  const before = f.state.commands.length;
  await f.manager.metrics();
  await f.manager.metrics();
  assert.ok(f.state.commands.slice(before).every(call => ['/bin/ps', '/usr/bin/memory_pressure', '/usr/sbin/sysctl'].includes(call.command)));
  assert.equal((await f.manager.terminate(processRequest, { dryRun: true })).simulated, true);
  assert.equal((await f.manager.unloadService(serviceRequest, { dryRun: true })).simulated, true);
  assert.deepEqual(f.state.signals, []);
});

test('agrupa o bundle externo e soma CPU e RSS dos auxiliares sem confundir instalações', async t => {
  const icons = [];
  const f = await fixture(t, { getIcon: async bundle => { icons.push(bundle); return null; } });
  f.state.rows.push(
    processRow(43, { ppid: 42, cpu: 2.7, rss: 1024, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }),
    processRow(44, { cpu: 1, rss: 512, executable: '/Users/Shared/Example.app/Contents/MacOS/Example' }),
  );
  const listed = await f.manager.list();
  const group = listed.processes.find(item => item.pid === 42);
  assert.deepEqual(group.pids, [42, 43]);
  assert.equal(group.processCount, 2);
  assert.equal(group.isAppGroup, true);
  assert.equal(group.cpu, 20);
  assert.equal(group.memoryBytes, 3 * 1024 ** 2);
  assert.equal(listed.processes.some(item => item.pid === 43), false);
  assert.notEqual(group.id, listed.processes.find(item => item.pid === 44).id);
  assert.equal(icons.filter(bundle => bundle === '/Applications/Example.app').length, 1);
  assert.equal(JSON.stringify(listed).includes('/Applications/'), false);
});

test('CPU e processos atualizam em meio segundo sem repetir consulta de pressão antes de cinco segundos', async t => {
  const f = await fixture(t);
  await f.manager.metrics();
  const pressureReads = () => f.state.commands.filter(item => item.command === '/usr/bin/memory_pressure').length;
  assert.equal(pressureReads(), 1);
  f.state.now += 500;
  f.state.rows.find(row => row.pid === 42).cpuTime = '00:10.25';
  const next = await f.manager.metrics();
  assert.equal(next.processes.find(item => item.pid === 42).cpu, 50);
  assert.equal(pressureReads(), 1);
  f.state.now += 4500;
  await f.manager.metrics();
  assert.equal(pressureReads(), 2);
});

test('agrupamento mantém processos protegidos fora da ação e ID estável quando muda o representante', async t => {
  const f = await fixture(t);
  f.state.rows.push(
    processRow(43, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }),
    processRow(44, { uid: UID + 1 }),
  );
  const first = await f.manager.list();
  const group = first.processes.find(item => item.pid === 42);
  assert.deepEqual(group.pids, [42, 43]);
  assert.equal(first.processes.find(item => item.pid === 44).canTerminate, false);
  f.state.rows = f.state.rows.filter(item => item.pid !== 42);
  const second = await f.manager.metrics();
  assert.equal(second.processes.find(item => item.pid === 43).id, group.id);
  assert.deepEqual(f.state.signals, []);
});

test('CPU ao vivo usa delta cumulativo por processo e suporta vários núcleos', async t => {
  const f = await fixture(t);
  f.state.rows.push(processRow(43, { ppid: 42, cpuTime: '00:20.00', executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
  const first = await f.manager.list();
  assert.equal(first.processes.find(item => item.pid === 42).cpu, 34.6);
  f.state.now += 1000;
  f.state.rows.find(item => item.pid === 42).cpuTime = '00:10.40';
  f.state.rows.find(item => item.pid === 43).cpuTime = '00:21.20';
  f.state.rows.find(item => item.pid === 43).rss = 4096;
  const second = await f.manager.metrics();
  const group = second.processes.find(item => item.pid === 42);
  assert.ok(Math.abs(group.cpu - 160) < 0.001);
  assert.equal(group.memoryBytes, 6 * 1024 ** 2);
  f.state.now += 1000;
  const third = await f.manager.metrics();
  assert.equal(third.processes.find(item => item.pid === 42).cpu, 0);
});

test('PID reaproveitado reinicia a amostra de CPU sem herdar o contador anterior', async t => {
  const f = await fixture(t);
  await f.manager.list();
  f.state.now += 1000;
  Object.assign(f.state.rows.find(item => item.pid === 42), { started: 'Sat Nov  7 20:28:24 2026', cpuTime: '00:30.00', cpu: 4.2 });
  const result = await f.manager.metrics();
  assert.equal(result.processes.find(item => item.pid === 42).cpu, 4.2);
});

test('falha de processos preserva gauges e confirmações com erro explícito da lista', async t => {
  const f = await fixture(t);
  await f.manager.list();
  const request = await f.processConsent(true);
  f.state.psError = true;
  const result = await f.manager.metrics();
  assert.equal(result.ok, true);
  assert.equal(result.systemMetrics.cpuPercent, 25);
  assert.equal(result.memoryPressure.level, 'normal');
  assert.equal(Object.hasOwn(result, 'processes'), false);
  assert.match(result.processError, /última leitura/);
  f.state.psError = false;
  assert.equal((await f.manager.terminate(request, { dryRun: true })).simulated, true);
});

test('encerrar app revisa todos os membros e só sinaliza os PIDs explicitamente confirmados', async t => {
  const f = await fixture(t);
  f.state.rows.push(processRow(43, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
  await f.manager.list();
  const prepared = await f.manager.prepareProcess(42, { dryRun: false });
  assert.equal(prepared.processCount, 2);
  assert.deepEqual(prepared.pids, [42, 43]);
  f.state.rows.push(processRow(44, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
  await f.manager.metrics(); // A nova leitura não troca os membros vinculados ao token.
  const result = await f.manager.terminate({ pid: 42, token: prepared.token, force: false, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.ok, true);
  assert.deepEqual(f.state.signals, [{ pid: 42, signal: 'SIGTERM' }, { pid: 43, signal: 'SIGTERM' }]);
  assert.equal((await f.manager.prepareProcess(42, { force: true, dryRun: false })).ok, false);
});

test('nenhum membro recebe sinal se um auxiliar mudou de dono ou identidade antes de confirmar', async t => {
  for (const change of [{ uid: UID + 1 }, { started: 'Sat Nov  7 20:28:24 2026' }]) {
    const f = await fixture(t);
    f.state.rows.push(processRow(43, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
    await f.manager.list();
    const request = await f.processConsent();
    Object.assign(f.state.rows.find(item => item.pid === 43), change);
    assert.equal((await f.manager.terminate(request, { dryRun: false })).ok, false);
    assert.deepEqual(f.state.signals, []);
  }
});

test('forçar app exige SIGTERM anterior de cada membro e uma nova revisão', async t => {
  const f = await fixture(t);
  f.state.rows.push(processRow(43, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
  await f.manager.list();
  await f.manager.terminate(await f.processConsent(), { dryRun: false });
  const listed = await f.manager.metrics();
  assert.equal(listed.processes.find(item => item.pid === 42).canForce, true);
  const forced = await f.processConsent(false, true);
  f.state.onSignal = pid => { f.state.rows = f.state.rows.filter(item => item.pid !== pid); };
  assert.equal((await f.manager.terminate(forced, { dryRun: false })).exited, true);
  assert.deepEqual(f.state.signals.slice(-2), [{ pid: 42, signal: 'SIGKILL' }, { pid: 43, signal: 'SIGKILL' }]);
});

test('forçar imediatamente após saída parcial revisa somente os membros restantes', async t => {
  const f = await fixture(t);
  f.state.rows.push(processRow(43, { ppid: 42, executable: '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper' }));
  await f.manager.list();
  f.state.onSignal = pid => { if (pid === 42) f.state.rows = f.state.rows.filter(item => item.pid !== pid); };
  const terminated = await f.manager.terminate(await f.processConsent(), { dryRun: false });
  assert.equal(terminated.canForce, true);
  const forced = await f.manager.prepareProcess(42, { force: true, dryRun: false });
  assert.equal(forced.ok, true);
  assert.deepEqual(forced.pids, [43]);
  f.state.onSignal = pid => { f.state.rows = f.state.rows.filter(item => item.pid !== pid); };
  assert.equal((await f.manager.terminate({ pid: 42, token: forced.token, force: true, expectedDryRun: false }, { dryRun: false })).exited, true);
  assert.deepEqual(f.state.signals.at(-1), { pid: 43, signal: 'SIGKILL' });
});

const cpu = (user, idle, sys = 0) => ({ times: { user, idle, sys, nice: 0, irq: 0 } });

test('CPU do sistema usa deltas de todos os núcleos e divide pela capacidade total', async t => {
  let read = 0;
  const snapshots = [[cpu(100, 100), cpu(200, 200)], [cpu(200, 100), cpu(200, 500)]];
  const f = await fixture(t, { getCpus: () => snapshots[read++] });
  // 100 ms ocupados em 400 ms de capacidade: 25%, sem somar porcentagens de processos.
  const result = await f.manager.list();
  assert.equal(result.systemMetrics.cpuPercent, 25);
  assert.equal(read, 2);
  assert.equal(result.systemMetrics.memoryUsedBytes, 12 * 1024 ** 3);
});

test('CPU ociosa e CPU saturada são leituras válidas de 0% e 100%', async t => {
  for (const [after, percent] of [[cpu(0, 100), 0], [cpu(100, 0), 100]]) {
    let read = 0;
    const f = await fixture(t, { getCpus: () => [read++ ? after : cpu(0, 0)] });
    assert.equal((await f.manager.list()).systemMetrics.cpuPercent, percent);
  }
});

test('amostra de CPU inválida fica indisponível sem ocultar a RAM nem impedir a lista', async t => {
  const cases = [
    [[], []],
    [[cpu(10, 10)], [cpu(20, 20), cpu(20, 20)]],
    [[cpu(10, 10)], [cpu(5, 30)]],
    [[cpu(10, 10)], [cpu(10, 10)]],
    [[cpu(10, 10)], [cpu(NaN, 20)]],
    [[cpu(10, 10)], [cpu(Infinity, 20)]],
  ];
  for (const snapshots of cases) {
    let read = 0;
    const f = await fixture(t, { getCpus: () => snapshots[read++] });
    const result = await f.manager.list();
    assert.equal(result.ok, true);
    assert.equal(result.systemMetrics.cpuPercent, null);
    assert.equal(result.systemMetrics.memoryUsedBytes, 12 * 1024 ** 3);
  }
  const f = await fixture(t, { waitForCpuSample: async () => { throw Error('sample unavailable'); } });
  const result = await f.manager.list();
  assert.equal(result.systemMetrics.cpuPercent, null);
  assert.equal(result.memoryPressure.level, 'normal');
});

test('RAM inválida fica indisponível independentemente da CPU e da pressão de memória', async t => {
  for (const memory of [{ total: 0, free: 0 }, { total: 16, free: 17 }, { total: 16, free: -1 }, { total: NaN, free: 0 }, { total: 16, free: null }]) {
    const f = await fixture(t, { getMemoryInfo: () => memory });
    const result = await f.manager.list();
    assert.deepEqual(result.systemMetrics, { cpuPercent: 25, memoryUsedBytes: null, memoryTotalBytes: null });
    assert.equal(result.memoryPressure.level, 'normal');
  }
  const f = await fixture(t, { getMemoryInfo: () => { throw Error('memory unavailable'); } });
  assert.deepEqual((await f.manager.list()).systemMetrics, { cpuPercent: 25, memoryUsedBytes: null, memoryTotalBytes: null });
});

test('processos auxiliares usam ícone do aplicativo pai sem enviar caminhos ao renderer', async t => {
  const seen = [];
  const f = await fixture(t, { getIcon: async bundle => { seen.push(bundle); return 'data:image/png;base64,aGVsbG8='; } });
  f.state.rows.find(row => row.pid === 42).executable = '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper';
  const result = await f.manager.list();
  assert.ok(seen.includes('/Applications/Example.app'));
  assert.equal(seen.some(bundle => bundle.includes('/Frameworks/')), false);
  assert.equal(result.processes.find(row => row.pid === 42).icon, 'data:image/png;base64,aGVsbG8=');
  assert.equal(JSON.stringify(result).includes('/Applications/'), false);
});

test('protege root, outros usuários, UIDs setuid, sistema, self, ancestrais e filhos indiretos', async t => {
  const f = await fixture(t);
  f.state.rows.push(
    processRow(44, { uid: UID + 1 }), processRow(45, { ruid: 0 }), processRow(46, { svuid: 0 }),
    processRow(47, { executable: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder' }),
    processRow(48, { ppid: 9999, executable: '/opt/helper' }), processRow(49, { ppid: 48, executable: '/opt/grandchild' }),
    processRow(50, { executable: '/usr/bin/sleep' }), processRow(51, { executable: 'path-incompleto' }));
  const result = await f.manager.list();
  for (const pid of [1, 1000, 9999, 44, 45, 46, 47, 48, 49, 50, 51]) {
    assert.equal(result.processes.find(row => row.pid === pid).canTerminate, false, String(pid));
    assert.equal((await f.manager.prepareProcess(pid, { dryRun: false })).ok, false, String(pid));
  }
  assert.deepEqual(f.state.signals, []);
});

test('ausência do próprio processo ou resposta inválida não autoriza sinais', async t => {
  const f = await fixture(t);
  f.state.rows = f.state.rows.filter(row => row.pid !== 9999);
  const result = await f.manager.list();
  assert.ok(result.processes.every(row => !row.canTerminate));
  assert.equal((await f.manager.prepareProcess(42, { dryRun: false })).ok, false);
  f.state.psError = true;
  assert.equal((await f.manager.list()).ok, false);
  assert.deepEqual(f.state.signals, []);
});

test('SIGTERM vem primeiro, SIGKILL exige nova revisão e confirmação', async t => {
  const f = await fixture(t);
  await f.manager.list();
  assert.equal((await f.manager.prepareProcess(42, { force: true, dryRun: false })).ok, false);
  const result = await f.manager.terminate(await f.processConsent(), { dryRun: false });
  assert.deepEqual(result, { ok: true, simulated: false, exited: false, canForce: true });
  assert.deepEqual(f.state.signals, [{ pid: 42, signal: 'SIGTERM' }]);
  const next = await f.manager.list();
  assert.equal(next.processes.find(row => row.pid === 42).canForce, true);
  f.state.onSignal = pid => { f.state.rows = f.state.rows.filter(row => row.pid !== pid); };
  const forced = await f.manager.terminate(await f.processConsent(false, true), { dryRun: false });
  assert.equal(forced.exited, true);
  assert.deepEqual(f.state.signals.at(-1), { pid: 42, signal: 'SIGKILL' });
});

test('simulação não envia sinais nem habilita forçar encerramento', async t => {
  const f = await fixture(t);
  await f.manager.list();
  const request = await f.processConsent(true);
  assert.equal((await f.manager.terminate(request, { dryRun: true })).simulated, true);
  assert.deepEqual(f.state.signals, []);
  assert.equal((await f.manager.prepareProcess(42, { force: true, dryRun: true })).ok, false);
  assert.equal((await f.manager.terminate(request, { dryRun: true })).ok, false);
});

test('tokens são de uso único, expiram e atualizar a lista invalida a revisão', async t => {
  const f = await fixture(t);
  await f.manager.list();
  const expired = await f.processConsent();
  f.state.now += 120001;
  assert.equal((await f.manager.terminate(expired, { dryRun: false })).ok, false);
  const stale = await f.processConsent();
  await f.manager.list();
  assert.equal((await f.manager.terminate(stale, { dryRun: false })).ok, false);
  assert.deepEqual(f.state.signals, []);
});

test('confirmação não aceita PID arbitrário, troca de modo ou SIGKILL adiantado', async t => {
  const f = await fixture(t);
  await f.manager.list();
  assert.equal((await f.manager.prepareProcess('42', { dryRun: false })).ok, false);
  assert.equal((await f.manager.prepareProcess(-42, { dryRun: false })).ok, false);
  assert.equal((await f.manager.prepareProcess(123456, { dryRun: false })).ok, false);
  for (const change of [{ pid: 1000 }, { force: true }, { expectedDryRun: true }, { expectedDryRun: undefined }]) {
    const request = { ...await f.processConsent(), ...change };
    assert.equal((await f.manager.terminate(request, { dryRun: false })).ok, false);
  }
  const request = await f.processConsent(true);
  assert.equal((await f.manager.terminate({ ...request, expectedDryRun: false }, { dryRun: false })).ok, false);
  assert.deepEqual(f.state.signals, []);
});

test('revalida dono, caminho e início, recusando PID reaproveitado antes do sinal', async t => {
  for (const change of [{ uid: UID + 1 }, { executable: '/Applications/Other.app/Contents/MacOS/Other' }, { started: 'Sat Nov  7 20:28:24 2026' }]) {
    const f = await fixture(t);
    await f.manager.list();
    const request = await f.processConsent();
    Object.assign(f.state.rows.find(row => row.pid === 42), change);
    assert.equal((await f.manager.terminate(request, { dryRun: false })).ok, false);
    assert.deepEqual(f.state.signals, []);
  }
});

test('erro de permissão no sinal não oferece SIGKILL nem elevação', async t => {
  const f = await fixture(t);
  await f.manager.list();
  f.state.killError = Object.assign(Error('denied'), { code: 'EPERM' });
  const result = await f.manager.terminate(await f.processConsent(), { dryRun: false });
  assert.equal(result.ok, false);
  assert.equal((await f.manager.prepareProcess(42, { force: true, dryRun: false })).ok, false);
  assert.equal(f.state.commands.some(call => call.command.includes('sudo')), false);
});

test('se o processo sair não oferece forçar e não confunde o novo dono do PID', async t => {
  const f = await fixture(t);
  await f.manager.list();
  f.state.onSignal = pid => { f.state.rows.find(row => row.pid === pid).started = 'Sat Nov  7 20:28:24 2026'; };
  const result = await f.manager.terminate(await f.processConsent(), { dryRun: false });
  assert.equal(result.exited, true);
  await f.manager.list();
  assert.equal((await f.manager.prepareProcess(42, { force: true, dryRun: false })).ok, false);
});

test('pressão indisponível não é inventada a partir de memória livre', async t => {
  const f = await fixture(t);
  const run = f.options.run;
  const manager = create({ ...f.options, run: async (cmd, args) => cmd === '/usr/sbin/sysctl' ? { stdout: '9\n' } : run(cmd, args) });
  const result = await manager.list();
  assert.deepEqual(result.memoryPressure, { level: 'unknown', freePercent: 37 });
  assert.ok(result.pressureError);
});

test('lista só LaunchAgents próprios e em execução, com IDs opacos', async t => {
  const f = await fixture(t);
  await f.agent();
  await f.agent('com.fixture.waiting', { pid: 44, state: 'waiting' });
  const result = await f.manager.list();
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0].label, 'com.fixture.worker');
  assert.equal(result.services[0].canUnload, true);
  assert.match(result.services[0].id, /^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(result).includes(f.home), false);
  assert.equal(f.state.commands.some(call => call.args[0] === 'bootout'), false);
});

test('serviço exige revisão e bootout mira só gui/UID/label, sem apagar o plist', async t => {
  const f = await fixture(t);
  const file = await f.agent();
  const service = (await f.manager.list()).services[0];
  const request = await f.serviceConsent(service.id);
  const result = await f.manager.unloadService(request, { dryRun: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(f.state.commands.filter(call => call.args[0] === 'bootout'), [{ command: '/bin/launchctl', args: ['bootout', `gui/${UID}/com.fixture.worker`] }]);
  assert.ok(await fs.stat(file));
  assert.equal((await f.manager.unloadService(request, { dryRun: false })).ok, false);
  assert.deepEqual(f.state.signals, []);
});

test('simulação de serviço mantém job e arquivo intactos', async t => {
  const f = await fixture(t);
  await f.agent();
  const service = (await f.manager.list()).services[0];
  assert.equal((await f.manager.unloadService(await f.serviceConsent(service.id, true), { dryRun: true })).simulated, true);
  assert.equal(f.state.jobs.has('com.fixture.worker'), true);
  assert.equal(f.state.commands.some(call => call.args[0] === 'bootout'), false);
});

test('serviços Apple, próprios e de outro UID não podem ser descarregados', async t => {
  const f = await fixture(t);
  await f.agent('com.apple.fixture', { pid: 43 });
  await f.agent('com.sejacalango.calangoclean.auto', { pid: 44 });
  await f.agent('com.fixture.otheruser', { pid: 45 });
  f.state.rows.find(row => row.pid === 45).uid = UID + 1;
  const result = await f.manager.list();
  assert.equal(result.services.length, 3);
  for (const item of result.services) {
    assert.equal(item.canUnload, false);
    assert.equal((await f.manager.prepareService(item.id, { dryRun: false })).ok, false);
  }
});

test('recusa plist e pasta por symlink, arquivos graváveis por outros e label inválido', async t => {
  const f = await fixture(t);
  const file = await f.agent();
  await fs.rename(file, path.join(f.home, 'elsewhere.plist'));
  await fs.symlink(path.join(f.home, 'elsewhere.plist'), file);
  assert.equal((await f.manager.list()).services.length, 0);
  await fs.unlink(file);
  await fs.rename(path.join(f.home, 'elsewhere.plist'), file);
  await fs.chmod(file, 0o666);
  assert.equal((await f.manager.list()).services.length, 0);
  await fs.chmod(file, 0o644);
  await fs.writeFile(file, JSON.stringify({ Label: 'bad/label', Program: '/opt/worker' }));
  assert.equal((await f.manager.list()).services.length, 0);
  await fs.rename(f.dir, `${f.dir}-real`);
  await fs.symlink(`${f.dir}-real`, f.dir);
  const result = await f.manager.list();
  assert.equal(result.services.length, 0);
  assert.ok(result.serviceError);
});

test('revalida conteúdo e identidade do plist, origem do job e PID antes de bootout', async t => {
  for (const kind of ['contents', 'origin', 'pid', 'owner', 'stopped']) {
    const f = await fixture(t);
    const file = await f.agent();
    const service = (await f.manager.list()).services[0];
    const request = await f.serviceConsent(service.id);
    if (kind === 'contents') await fs.appendFile(file, ' ');
    if (kind === 'origin') f.state.jobs.get(service.label).file = '/Library/LaunchAgents/other.plist';
    if (kind === 'pid') f.state.jobs.get(service.label).pid = 42;
    if (kind === 'owner') f.state.rows.find(row => row.pid === 43).uid = UID + 1;
    if (kind === 'stopped') f.state.jobs.delete(service.label);
    assert.equal((await f.manager.unloadService(request, { dryRun: false })).ok, false, kind);
    assert.equal(f.state.commands.some(call => call.args[0] === 'bootout'), false, kind);
  }
});

test('serviço com mesmo label mas origem diferente nunca é autorizado', async t => {
  const f = await fixture(t);
  await f.agent('com.fixture.worker', { file: '/Library/LaunchAgents/com.fixture.worker.plist' });
  const result = await f.manager.list();
  assert.equal(result.services.length, 0);
  assert.ok(result.serviceError);
});

test('tokens de serviços também recusam modo alterado, id arbitrário e revisão vencida', async t => {
  const f = await fixture(t);
  await f.agent();
  let service = (await f.manager.list()).services[0];
  let request = await f.serviceConsent(service.id);
  assert.equal((await f.manager.unloadService({ ...request, id: '/Library/LaunchAgents/foo.plist' }, { dryRun: false })).ok, false);
  request = await f.serviceConsent(service.id, true);
  assert.equal((await f.manager.unloadService({ ...request, expectedDryRun: false }, { dryRun: false })).ok, false);
  request = await f.serviceConsent(service.id);
  await f.manager.list();
  assert.equal((await f.manager.unloadService(request, { dryRun: false })).ok, false);
  assert.equal(f.state.commands.some(call => call.args[0] === 'bootout'), false);
});
