const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createInstaller, TARGET, BUNDLE_ID } = require('../scripts/install-local');

async function bundle(target, version = '0.4.2', overrides = {}) {
  await fs.mkdir(path.join(target, 'Contents', 'MacOS'), { recursive: true });
  await fs.writeFile(path.join(target, 'Contents', 'Info.plist'), JSON.stringify({
    CFBundleIdentifier: BUNDLE_ID, CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version, CFBundleExecutable: 'CalangoClean', ...overrides,
  }));
  await fs.writeFile(path.join(target, 'Contents', 'MacOS', 'CalangoClean'), `fixture ${version}`, { mode: 0o755 });
}

async function fixture(t, oldVersion = '0.4.1') {
  // /tmp and /var are symlinks on macOS; use a real temporary root.
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, 'calangoclean-install-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'Applications');
  const target = path.join(parent, 'CalangoClean.app');
  const source = path.join(root, 'source', 'CalangoClean.app');
  await fs.mkdir(parent);
  await bundle(source);
  if (oldVersion) await bundle(target, oldVersion);
  const calls = [];
  const context = { root, parent, target, source, calls, hook: null, io: { ...fs } };
  context.run = async (program, args) => {
    calls.push({ program, args });
    // Every file-bearing external command is faked and confined to this fixture.
    if (program !== '/usr/bin/pgrep') assert.ok(args.at(-1).startsWith(root + path.sep));
    const hooked = await context.hook?.(program, args);
    if (hooked) return hooked;
    if (program === '/usr/bin/pgrep') return { code: 1, stdout: '' };
    if (program === '/usr/bin/plutil') return { code: 0, stdout: await fs.readFile(args.at(-1), 'utf8') };
    if (program === '/usr/bin/codesign') return { code: 0, stdout: '' };
    if (program === '/usr/bin/ditto') {
      await fs.cp(args[0], args[1], { recursive: true, dereference: false, verbatimSymlinks: true });
      return { code: 0, stdout: '' };
    }
    throw new Error(`Unexpected fixture command: ${program}`);
  };
  context.install = (sourcePath = source) => createInstaller({ target, io: context.io, run: context.run }).install(sourcePath);
  context.version = async (where = target) => JSON.parse(await fs.readFile(path.join(where, 'Contents/Info.plist'), 'utf8')).CFBundleShortVersionString;
  context.clean = async () => assert.deepEqual((await fs.readdir(parent)).filter((name) => name.startsWith('.CalangoClean')), []);
  return context;
}

test('instalação inicial, atualização e reinstalação deixam só o bundle atual e preservam os dados', async (t) => {
  assert.equal(TARGET, '/Applications/CalangoClean.app');
  for (const oldVersion of [null, '0.4.1', '0.4.2']) {
    const f = await fixture(t, oldVersion);
    const data = path.join(f.root, 'Library', 'config.json');
    await fs.mkdir(path.dirname(data));
    await fs.writeFile(data, 'preferências preservadas');
    const result = await f.install();
    assert.equal(result.ok, true, result.error);
    assert.equal(result.status, 'installed');
    assert.equal(result.previousVersion, oldVersion);
    assert.equal(await f.version(), '0.4.2');
    assert.equal(await fs.readFile(data, 'utf8'), 'preferências preservadas');
    assert.equal(await f.version(f.source), '0.4.2');
    await f.clean();
  }
});

test('recusa downgrade e metadados de origem ou destino que não sejam do CalangoClean', async (t) => {
  for (const scenario of ['downgrade', 'source-id', 'target-id', 'invalid-version']) {
    const f = await fixture(t, scenario === 'downgrade' ? '0.5.0' : '0.4.1');
    if (scenario === 'source-id') await bundle(f.source, '0.4.2', { CFBundleIdentifier: 'outro.app' });
    if (scenario === 'target-id') await bundle(f.target, '0.4.1', { CFBundleIdentifier: 'outro.app' });
    if (scenario === 'invalid-version') await bundle(f.source, '0.4.2-beta');
    const before = await fs.readFile(path.join(f.target, 'Contents/Info.plist'), 'utf8');
    const result = await f.install();
    assert.equal(result.ok, false, scenario);
    assert.equal(result.status, 'failed');
    assert.equal(await fs.readFile(path.join(f.target, 'Contents/Info.plist'), 'utf8'), before);
    assert.equal(f.calls.some((call) => call.program === '/usr/bin/ditto'), false);
    await f.clean();
  }
});

test('recusa symlinks na origem, destino ou pastas ancestrais sem alterar seus alvos', async (t) => {
  for (const scenario of ['source', 'target', 'source-parent', 'target-parent']) {
    const f = await fixture(t);
    let source = f.source;
    if (scenario === 'source') {
      source = path.join(f.root, 'link.app');
      await fs.symlink(f.source, source);
    } else if (scenario === 'target') {
      const real = path.join(f.root, 'real-old.app');
      await fs.rename(f.target, real);
      await fs.symlink(real, f.target);
    } else if (scenario === 'source-parent') {
      const link = path.join(f.root, 'source-link');
      await fs.symlink(path.dirname(f.source), link);
      source = path.join(link, 'CalangoClean.app');
    } else {
      const real = path.join(f.root, 'real-applications');
      await fs.rename(f.parent, real);
      await fs.symlink(real, f.parent);
    }
    const result = await f.install(source);
    assert.equal(result.ok, false, scenario);
    assert.match(result.error, /link simbólico/);
    assert.equal(await f.version(), '0.4.1');
    assert.equal(await f.version(f.source), '0.4.2');
  }
});

test('recusa app em execução antes ou depois da preparação e falha ao consultar processos', async (t) => {
  for (const scenario of ['running', 'started-later', 'process-error']) {
    const f = await fixture(t);
    let checks = 0;
    f.hook = async (program) => {
      if (program !== '/usr/bin/pgrep') return;
      checks++;
      return { code: scenario === 'process-error' ? 2 : scenario === 'started-later' && checks === 1 ? 1 : 0 };
    };
    const result = await f.install();
    assert.equal(result.ok, false, scenario);
    assert.equal(await f.version(), '0.4.1');
    await f.clean();
  }
});

test('assinatura inválida na origem ou staging impede a troca e remove temporários', async (t) => {
  for (const scenario of ['source', 'staging']) {
    const f = await fixture(t);
    f.hook = async (program, args) => {
      if (program === '/usr/bin/codesign' && (scenario === 'source' ? args.at(-1) === f.source : args.at(-1).endsWith('/incoming.app'))) return { code: 1 };
    };
    const result = await f.install();
    assert.equal(result.ok, false, scenario);
    assert.match(result.error, /assinatura/);
    assert.equal(await f.version(), '0.4.1');
    await f.clean();
  }
});

test('falha de cópia parcial preserva anterior e apaga somente a preparação própria', async (t) => {
  const f = await fixture(t);
  f.hook = async (program, args) => {
    if (program === '/usr/bin/ditto') {
      await fs.mkdir(args[1]);
      await fs.writeFile(path.join(args[1], 'partial'), 'incompleto');
      return { code: 1 };
    }
  };
  const result = await f.install();
  assert.equal(result.ok, false);
  assert.equal(await f.version(), '0.4.1');
  await f.clean();
});

test('falha ao mover a nova versão restaura a anterior e elimina staging', async (t) => {
  const f = await fixture(t);
  f.io.rename = async (from, to) => {
    if (from.endsWith('/incoming.app') && to === f.target) throw new Error('fixture: rename recusado');
    return fs.rename(from, to);
  };
  const result = await f.install();
  assert.equal(result.ok, false);
  assert.match(result.error, /rename recusado/);
  assert.equal(await f.version(), '0.4.1');
  await f.clean();
});

test('falha ao validar o destino depois da troca restaura a versão anterior', async (t) => {
  const f = await fixture(t);
  f.hook = async (program, args) => {
    if (program === '/usr/bin/codesign' && args.at(-1) === f.target && await f.version() === '0.4.2') return { code: 1 };
  };
  const result = await f.install();
  assert.equal(result.ok, false);
  assert.equal(result.installed, false);
  assert.equal(await f.version(), '0.4.1');
  await f.clean();
});

test('alteração externa cancela a troca ou preserva rollback sem sobrescrever o novo ocupante', async (t) => {
  for (const moment of ['before-swap', 'after-old-moved']) {
    const f = await fixture(t);
    if (moment === 'before-swap') {
      f.hook = async (program) => {
        if (program === '/usr/bin/ditto') await bundle(f.target, '0.9.0');
      };
    } else {
      f.io.rename = async (from, to) => {
        await fs.rename(from, to);
        if (from === f.target) await bundle(f.target, '0.9.0');
      };
    }
    const result = await f.install();
    assert.equal(result.ok, false, moment);
    assert.equal(await f.version(), '0.9.0');
    if (moment === 'before-swap') await f.clean();
    else {
      assert.equal(result.status, 'recovery-required');
      const stage = result.cleanupPending[0];
      assert.equal(await f.version(path.join(stage, 'previous.app')), '0.4.1');
      assert.equal((await fs.readdir(f.parent)).includes('.CalangoClean-install.lock'), false);
    }
  }
});

test('falha de limpeza e lock substituído externamente são informados sem remover nova versão válida', async (t) => {
  for (const scenario of ['cleanup-failure', 'foreign-lock']) {
    const f = await fixture(t);
    if (scenario === 'cleanup-failure') f.io.rm = async () => { throw new Error('fixture: sem permissão para remover'); };
    else {
      f.hook = async (program, args) => {
        if (program === '/usr/bin/codesign' && args.at(-1) === f.target && await f.version() === '0.4.2') {
          const lock = path.join(f.parent, '.CalangoClean-install.lock');
          await fs.unlink(lock);
          await fs.writeFile(lock, 'lock externo');
        }
      };
    }
    const result = await f.install();
    assert.equal(result.ok, false, scenario);
    assert.equal(result.status, 'cleanup-pending');
    assert.equal(result.installed, true);
    assert.equal(result.cleanupPending.length, 1);
    assert.equal(await f.version(), '0.4.2');
    if (scenario === 'foreign-lock') assert.equal(await fs.readFile(result.cleanupPending[0], 'utf8'), 'lock externo');
  }
});

test('lock exclusivo impede duas instalações simultâneas sem remover lock da primeira', async (t) => {
  const f = await fixture(t);
  let reachedCopy, resume;
  const copying = new Promise((resolve) => { reachedCopy = resolve; });
  const paused = new Promise((resolve) => { resume = resolve; });
  f.hook = async (program) => {
    if (program === '/usr/bin/ditto') { reachedCopy(); await paused; }
  };
  const first = f.install();
  await copying;
  const second = await f.install();
  assert.equal(second.ok, false);
  assert.match(second.error, /lock pendente/);
  assert.equal((await fs.readdir(f.parent)).includes('.CalangoClean-install.lock'), true);
  resume();
  assert.equal((await first).ok, true);
  await f.clean();
});

test('origem alterada durante a cópia é recusada antes de trocar a instalação', async (t) => {
  const f = await fixture(t);
  f.hook = async (program) => {
    if (program === '/usr/bin/ditto') await fs.writeFile(path.join(f.source, 'unexpected'), 'alteração concorrente');
  };
  const result = await f.install();
  assert.equal(result.ok, false);
  assert.match(result.error, /origem mudou/);
  assert.equal(await f.version(), '0.4.1');
  await f.clean();
});
