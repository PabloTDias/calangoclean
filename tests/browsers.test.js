const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const disk = require('../src/disk');
const { create, excludedCacheRoots } = require('../src/browsers');
const { create: createCategory } = require('../src/categories/chromeServiceWorker');

async function fixture(t, overrides = {}) {
  const home = await fs.mkdtemp(path.join(__dirname, '.browser-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const write = async suffix => {
    const p = path.join(home, 'Library', suffix);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Buffer.alloc(8192, 1));
    return p;
  };
  const storage = { ...disk, hasFullDiskAccess: async () => true, ...overrides.storage };
  const execute = overrides.execute || (async (cmd) => {
    assert.equal(cmd, '/bin/ps', 'test must never execute AppleScript or any real process');
    return { stdout: '', err: null };
  });
  const service = create({ home, storage, execute, ...overrides });
  return { home, write, storage, service, cat: createCategory({ browserService: service, storage }) };
}

test('encontra caches de todos os perfis Chromium e de outros browsers, preservando dados pessoais', async t => {
  const { service, cat, write } = await fixture(t);
  const caches = await Promise.all([
    write('Caches/Google/Chrome/Default/Cache/item'),
    write('Application Support/Google/Chrome/Default/Service Worker/CacheStorage/site/item'),
    write('Application Support/Google/Chrome/Profile 2/Code Cache/item'),
    write('Application Support/Microsoft Edge/Profile 3/GPUCache/item'),
    write('Caches/Firefox/Profiles/random.default/cache2/entries/item'),
    write('Containers/com.apple.Safari/Data/Library/Caches/com.apple.Safari/item'),
    write('Application Support/BraveSoftware/Brave-Browser/Default/Cache/item'),
    write('Application Support/Arc/User Data/Default/Cache/item'),
    write('Application Support/com.operasoftware.Opera/Cache/item'),
  ]);
  const keep = await Promise.all([
    write('Application Support/Google/Chrome/Default/Cookies'),
    write('Application Support/Google/Chrome/Default/IndexedDB/site/database'),
    write('Application Support/Google/Chrome/Default/History'),
    write('Application Support/Google/Chrome/Default/Sessions/session'),
    write('Application Support/Google/Chrome/DoNotClean/Cache/item'),
    write('Application Support/Google/Chrome/Profile 2/Service Worker/Database/registry'),
    write('Safari/History.db'),
  ]);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.accessIssue, null);
  assert.equal(snapshot.measurementError, false);
  assert.deepEqual(snapshot.browsers.map(b => b.id).sort(), ['chrome', 'edge', 'firefox', 'safari', 'brave', 'arc', 'opera'].sort());
  const before = await cat.measure();
  assert.ok(before >= 8192 * caches.length);
  const simulation = await cat.clean({ dryRun: true });
  assert.equal(simulation.freedBytes, before);
  for (const p of caches) assert.equal(await disk.exists(p), true);
  const result = await cat.clean({ dryRun: false });
  assert.ok(result.freedBytes > 0);
  assert.equal(result.status, 'ok');
  for (const p of caches) assert.equal(await disk.exists(p), false);
  for (const p of keep) assert.equal(await disk.exists(p), true);
});

test('sem Acesso Total ao Disco não tenta acessar pastas dos browsers', async () => {
  let reads = 0;
  const service = create({
    storage: { hasFullDiskAccess: async () => false },
    io: { lstat: async () => { reads++; throw new Error('must not read'); }, readdir: async () => { reads++; throw new Error('must not read'); } },
    execute: async () => ({ stdout: '' }),
  });
  const cat = createCategory({ browserService: service });
  assert.equal(await cat.detect(), true);
  assert.match(await cat.accessIssue(), /sem permissão/);
  assert.equal(await cat.measure(), 0);
  assert.equal((await cat.clean({ dryRun: false })).skipped, true);
  assert.equal(reads, 0);
});

test('simulação mede com browser aberto e limpeza real só limpa os browsers fechados', async t => {
  const { cat, write } = await fixture(t, { execute: async () => ({ stdout: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' }) });
  const chrome = await write('Caches/Google/Chrome/Default/Cache/item');
  const firefox = await write('Caches/Firefox/Profiles/default/cache2/entries/item');
  assert.match(await cat.blockedReason(), /Google Chrome/);
  assert.deepEqual((await cat.settings()).runningBrowsers.map(b => b.id), ['chrome']);
  assert.ok((await cat.clean({ dryRun: true })).freedBytes > 0);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'partial');
  assert.match(result.reason, /Google Chrome.*aberto/);
  assert.equal(await disk.exists(chrome), true);
  assert.equal(await disk.exists(firefox), false);
});

test('recusa caches e pasta de perfis com link simbólico sem seguir o destino', async t => {
  const { home, service, cat, write } = await fixture(t);
  const outside = await write('Caches/outside/keep');
  await fs.mkdir(path.join(home, 'Library', 'Application Support', 'Google'), { recursive: true });
  await fs.symlink(path.dirname(outside), path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
  await fs.mkdir(path.join(home, 'Library', 'Caches', 'Google'), { recursive: true });
  await fs.symlink(path.dirname(outside), path.join(home, 'Library', 'Caches', 'Google', 'Chrome'));
  const s = await service.snapshot();
  assert.equal(s.measurementError, true);
  assert.match(s.problems.join('; '), /link simbólico/);
  assert.equal((await cat.clean({ dryRun: false })).skipped, true);
  assert.equal(await disk.exists(outside), true);
});

test('browser que abre durante a limpeza tem seus caches preservados', async t => {
  let reads = 0;
  const { cat, write } = await fixture(t, { execute: async () => ({ stdout: ++reads === 1 ? '' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' }) });
  const cache = await write('Caches/Google/Chrome/Default/Cache/item');
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /aberto durante/);
  assert.equal(await disk.exists(cache), true);
});

test('raízes de exclusão dos caches de apps só contêm diretórios de cache explícitos', () => {
  const roots = excludedCacheRoots('/Users/test');
  assert.ok(roots.includes('/Users/test/Library/Caches/Google/Chrome'));
  assert.ok(roots.includes('/Users/test/Library/Caches/Firefox'));
  assert.ok(roots.includes('/Users/test/Library/Caches/com.apple.Safari'));
  assert.ok(roots.every(p => p.startsWith('/Users/test/Library/Caches/')));
});

test('detecção não confunde helpers com browsers e falha de ps impede limpeza', async t => {
  const service = create({ execute: async () => ({ stdout: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper\n/Applications/Firefox.app/Contents/MacOS/firefox\n' }) });
  assert.deepEqual(await service.running(), [{ id: 'firefox', name: 'Firefox' }]);
  const { cat, write } = await fixture(t, { execute: async () => ({ err: new Error('ps failed'), stdout: '' }) });
  const cache = await write('Caches/Google/Chrome/Default/Cache/item');
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /verificar/);
  assert.equal(await disk.exists(cache), true);
});

test('quit aceita somente ids fixos, não força encerramento e verifica saída do browser', async () => {
  const calls = [];
  let open = true;
  const service = create({ execute: async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === '/bin/ps') return { stdout: open ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' : '' };
    assert.equal(cmd, '/usr/bin/osascript');
    open = false;
    return { stdout: '' };
  } });
  const result = await service.quit(['chrome', 'chrome', 'Chrome" do shell script "oops', 'firefox']);
  assert.deepEqual(result.closed, [{ id: 'chrome', name: 'Google Chrome' }]);
  assert.deepEqual(result.failed, []);
  const scriptCalls = calls.filter(c => c.cmd === '/usr/bin/osascript');
  assert.equal(scriptCalls.length, 1);
  assert.deepEqual(scriptCalls[0].args, ['-e', 'if application id "com.google.Chrome" is running then tell application id "com.google.Chrome" to quit']);
  assert.ok(calls.every(c => !/kill/.test(c.cmd)));
});

test('quit reporta recusa de Automação e navegador que continua aberto', async () => {
  let clock = 0;
  const safari = '/Applications/Safari.app/Contents/MacOS/Safari\n';
  const denied = create({ execute: async cmd => cmd === '/bin/ps' ? { stdout: safari } : { err: new Error('denied'), stderr: 'Not authorized (-1743)' } });
  let result = await denied.quit(['safari']);
  assert.deepEqual(result.closed, []);
  assert.match(result.failed[0].reason, /Automação/);
  const stuck = create({
    execute: async cmd => ({ stdout: cmd === '/bin/ps' ? safari : '' }),
    now: () => clock,
    sleep: async ms => { clock += ms; },
  });
  result = await stuck.quit(['safari'], { timeoutMs: 500 });
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /continua aberto/);
  assert.ok(clock >= 500);
});
