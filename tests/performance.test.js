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
    elapsed: '01:02:03', started: 'Sat Nov  7 20:28:23 2026', executable: '/Applications/Example.app/Contents/MacOS/Example', ...overrides };
}
function output(rows) {
  return rows.map(row => ` ${row.pid} ${row.ppid} ${row.uid} ${row.ruid} ${row.svuid} ${row.cpu} ${row.rss} ${row.elapsed} ${row.started} ${row.executable}`).join('\n');
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
  ], commands: [], signals: [], jobs: new Map(), killError: null, psError: false, onSignal: null };
  const options = { home, uid: UID, selfPid: 9999, selfPath: '/Applications/CalangoClean.app', now: () => state.now,
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
  assert.throws(() => parseProcesses('resposta inválida'));
  assert.throws(() => parseProcesses(output([processRow(), processRow()])));
});

test('lista métricas só por chamada, sem expor executáveis nem início ao renderer', async t => {
  const f = await fixture(t);
  assert.equal(f.state.commands.length, 0);
  const result = await f.manager.list();
  assert.equal(result.ok, true);
  assert.equal(result.processes.find(row => row.pid === 42).canTerminate, true);
  assert.deepEqual(result.memoryPressure, { level: 'normal', freePercent: 37 });
  assert.equal(JSON.stringify(result).includes('/Applications/'), false);
  assert.equal(f.state.signals.length, 0);
  assert.equal(f.state.commands.filter(call => call.command === '/bin/ps').length, 1);
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
