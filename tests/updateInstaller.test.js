const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { create, download, checkInstallLocation } = require('../src/updateInstaller');

const URL_OK = 'https://github.com/PabloTDias/calangoclean/releases/download/v0.5.0/CalangoClean.dmg';
const BODY = Buffer.from('conteúdo fictício do instalador');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Servidor HTTPS falso: github.com redireciona para o CDN, que entrega o corpo.
function fakeRequest({ body = BODY, redirectTo = 'https://release-assets.githubusercontent.com/x', status = 200 } = {}) {
  const urls = [];
  return Object.assign((url, _opts, cb) => {
    urls.push(String(url));
    const req = new EventEmitter();
    req.destroy = (e) => req.emit('error', e);
    req.setTimeout = () => {};
    setImmediate(() => {
      const res = new (require('node:stream').PassThrough)();
      if (new URL(url).hostname === 'github.com' && redirectTo) {
        res.statusCode = 302; res.headers = { location: redirectTo }; cb(res); res.end(); return;
      }
      res.statusCode = status; res.headers = { 'content-length': String(body.length) };
      cb(res); res.end(body);
    });
    return req;
  }, { urls });
}

function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calango-upd-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appBundle = path.join(root, 'Apps', 'CalangoClean.app');
  fs.mkdirSync(appBundle, { recursive: true });
  fs.writeFileSync(path.join(appBundle, 'antiga'), 'v-antiga');
  const appDir = path.join(root, 'data'); fs.mkdirSync(appDir);
  const work = path.join(root, 'tmp'); fs.mkdirSync(work);
  const logs = []; const calls = { spawn: [], quit: 0, run: [] };
  const runner = async (cmd, args) => {
    calls.run.push([cmd, ...args]);
    if (cmd.endsWith('plutil')) return { stdout: args.includes('CFBundleIdentifier') ? 'com.sejacalango.calangoclean\n' : '0.5.0\n' };
    if (cmd.endsWith('hdiutil') && args[0] === 'attach') {
      const mnt = args[args.indexOf('-mountpoint') + 1];
      fs.mkdirSync(path.join(mnt, 'CalangoClean.app', 'Contents'), { recursive: true });
    }
    return { stdout: '' };
  };
  const installer = create({
    appBundle, version: '0.4.4', appDir, historyFile: path.join(appDir, 'history.log'), workRoot: work,
    mutations: require('../src/mutationGate').create(), runner,
    log: async (e) => { logs.push(e); }, quit: () => { calls.quit++; },
    spawnHelper: (...a) => calls.spawn.push(a), request: fakeRequest(), ...overrides,
  });
  const available = { version: '0.5.0', url: URL_OK, sha256: sha(BODY), size: BODY.length, name: 'CalangoClean.dmg' };
  return { root, appBundle, work, installer, logs, calls, available, appDir };
}

test('fluxo feliz: baixa, confere SHA-256, monta, valida e entrega ao script auxiliar sem tocar no app atual', async (t) => {
  const s = setup(t);
  const phases = [];
  const r = await s.installer.install(s.available, (p) => phases.push(p.phase));
  assert.deepEqual(r, { ok: true });
  assert.ok(['download', 'verify', 'mount', 'restart'].every((p) => phases.includes(p)));
  assert.equal(s.calls.quit, 1);
  assert.equal(s.calls.spawn.length, 1);
  const [script, args] = s.calls.spawn[0];
  assert.ok(fs.statSync(script).mode & 0o100, 'script executável');
  assert.equal(args[2], s.appBundle);
  assert.equal(args[7], '0.4.4'); assert.equal(args[8], '0.5.0');
  assert.equal(fs.readFileSync(path.join(s.appBundle, 'antiga'), 'utf8'), 'v-antiga', 'app instalado intacto até o script agir');
  assert.ok(s.logs.some((l) => /SHA-256 conferido/.test(l.note)));
});

test('SHA-256 diferente cancela, apaga o DMG e mantém a versão atual', async (t) => {
  const s = setup(t);
  const r = await s.installer.install({ ...s.available, sha256: 'f'.repeat(64) });
  assert.equal(r.ok, false);
  assert.match(r.error, /SHA-256/);
  assert.equal(s.calls.spawn.length, 0); assert.equal(s.calls.quit, 0);
  assert.deepEqual(fs.readdirSync(s.work), [], 'nada fica na pasta temporária');
  assert.ok(s.logs.some((l) => l.status === 'failed'));
  assert.equal(s.calls.run.some((c) => c[1] === 'attach'), false, 'nunca monta arquivo não verificado');
});

test('tamanho diferente do publicado é recusado', async (t) => {
  const s = setup(t);
  const r = await s.installer.install({ ...s.available, size: BODY.length + 5 });
  assert.equal(r.ok, false);
  assert.equal(s.calls.spawn.length, 0);
});

test('app do instalador com id ou versão errados é recusado e o disco é ejetado', async (t) => {
  const s = setup(t, { runner: async (cmd, args) => {
    if (cmd.endsWith('plutil')) return { stdout: args.includes('CFBundleIdentifier') ? 'com.outro.app\n' : '0.5.0\n' };
    if (args[0] === 'attach') fs.mkdirSync(path.join(args[args.indexOf('-mountpoint') + 1], 'CalangoClean.app'), { recursive: true });
    s_calls.push(args[0]); return { stdout: '' };
  } });
  const s_calls = [];
  const r = await s.installer.install(s.available);
  assert.equal(r.ok, false);
  assert.ok(s_calls.includes('detach'));
  assert.equal(s.calls.spawn.length, 0);
});

test('só aceita download HTTPS dentro do GitHub, inclusive nos redirecionamentos', async (t) => {
  const s = setup(t);
  const dest = path.join(s.work, 'a.dmg');
  await assert.rejects(download('http://github.com/x.dmg', dest, {}), /não permitido/);
  await assert.rejects(download('https://evil.example/x.dmg', dest, {}), /não permitido/);
  await assert.rejects(download(URL_OK, dest, { request: fakeRequest({ redirectTo: 'https://evil.example/x' }) }), /não permitido/);
  await assert.rejects(download(URL_OK, dest, { request: fakeRequest({ redirectTo: 'http://objects.githubusercontent.com/x' }) }), /não permitido/);
});

test('recusa instalar fora de CalangoClean.app, em DMG/quarentena ou sem escrita; em desenvolvimento não há app', async () => {
  await assert.rejects(checkInstallLocation(null), /instalado/);
  await assert.rejects(checkInstallLocation('/Applications/Outro.app'), /instalado/);
  await assert.rejects(checkInstallLocation('/Volumes/CalangoClean/CalangoClean.app'), /Aplicativos/);
  await assert.rejects(checkInstallLocation('/private/var/folders/x/AppTranslocation/y/d/CalangoClean.app'), /Aplicativos/);
});

test('rejeita atualização inválida ou não mais nova antes de qualquer rede', async (t) => {
  const s = setup(t);
  for (const bad of [null, { ...s.available, version: '0.4.4' }, { ...s.available, sha256: 'xyz' }, { ...s.available, url: 'https://evil.example/a.dmg' }]) {
    assert.equal((await s.installer.install(bad)).ok, false);
  }
  assert.equal(s.calls.spawn.length, 0);
});

test('limpeza em andamento impede a atualização e remove os temporários', async (t) => {
  const s = setup(t);
  const gate = require('../src/mutationGate').create();
  let release; const holding = gate.run(() => new Promise((r) => { release = r; }));
  const installer = create({ appBundle: s.appBundle, version: '0.4.4', appDir: s.appDir, historyFile: 'h', workRoot: s.work, mutations: gate,
    runner: async (cmd, args) => { if (cmd.endsWith('plutil')) return { stdout: args.includes('CFBundleIdentifier') ? 'com.sejacalango.calangoclean\n' : '0.5.0\n' };
      if (args[0] === 'attach') fs.mkdirSync(path.join(args[args.indexOf('-mountpoint') + 1], 'CalangoClean.app'), { recursive: true }); return { stdout: '' }; },
    request: fakeRequest(), spawnHelper: () => assert.fail('não pode iniciar'), quit: () => assert.fail('não pode encerrar') });
  const r = await installer.install(s.available);
  release(); await holding;
  assert.equal(r.ok, false); assert.match(r.error, /limpeza/);
  assert.deepEqual(fs.readdirSync(s.work), []);
});

test('lê e apaga o resultado deixado pelo script auxiliar', async (t) => {
  const s = setup(t);
  assert.equal(await s.installer.takeResult(), null);
  fs.writeFileSync(path.join(s.appDir, 'update-result.json'), JSON.stringify({ ok: false, from: '0.4.4', to: '0.5.0', error: 'x' }));
  assert.deepEqual(await s.installer.takeResult(), { ok: false, from: '0.4.4', to: '0.5.0', error: 'x' });
  assert.equal(await s.installer.takeResult(), null);
});
