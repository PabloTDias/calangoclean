const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../src/applications');

// Todos os caminhos pertencem a fixtures temporárias. A Lixeira real nunca é chamada.
async function fixture(t, overrides = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'calango-applications-'));
  const root = path.join(base, 'Applications');
  await fs.mkdir(root);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const moved = [];
  const options = { roots: [root], readLastUsed: async () => null, readPlist: async file => JSON.parse(await fs.readFile(file, 'utf8')),
    isRunning: async () => false, trashItem: async item => { moved.push(item); }, ...overrides };
  const manager = create(options);
  async function app(name = 'Exemplo', metadata = {}, relativeRoot = root) {
    const bundle = path.join(relativeRoot, `${name}.app`);
    await fs.mkdir(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'Contents', 'MacOS', 'binary'), 'executable fixture');
    await fs.writeFile(path.join(bundle, 'Contents', 'Info.plist'), JSON.stringify({
      CFBundleIdentifier: `com.fixture.${name.replace(/[^A-Za-z0-9]/g, '') || 'app'}`,
      CFBundleName: name, CFBundleExecutable: 'binary', CFBundleShortVersionString: '1.2.3',
      CFBundlePackageType: 'APPL', ...metadata,
    }));
    return bundle;
  }
  async function selected(name = 'Exemplo') {
    const result = await manager.list();
    assert.equal(result.ok, true);
    return result.items.find(item => item.name === name);
  }
  async function consent(item) {
    const prepared = await manager.prepare(item.id);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    return { id: item.id, token: prepared.token, expectedDryRun: false };
  }
  return { base, root, manager, app, selected, consent, moved, options };
}

test('lista apps de subpastas com IDs opacos, sem entrar nos bundles nem expor caminhos', async t => {
  const f = await fixture(t);
  await f.app();
  await fs.mkdir(path.join(f.root, 'pasta'));
  await f.app('Aninhado', {}, path.join(f.root, 'pasta'));
  const result = await f.manager.list();
  assert.equal(result.items.length, 2);
  const item = result.items.find(item => item.name === 'Exemplo');
  assert.equal(item.name, 'Exemplo');
  assert.equal(item.version, '1.2.3');
  assert.equal(item.bytes, null);
  assert.equal(item.canUninstall, true);
  assert.match(item.id, /^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(result).includes(f.root), false);
});

test('ícone do app é fornecido pelo main após validar o bundle sem expor seu caminho', async t => {
  const seen = [];
  const f = await fixture(t, { getIcon: async bundle => { seen.push(bundle); return 'data:image/png;base64,aGVsbG8='; } });
  const bundle = await f.app();
  const result = await f.manager.list();
  assert.deepEqual(seen, [await fs.realpath(bundle)]);
  assert.equal(result.items[0].icon, 'data:image/png;base64,aGVsbG8=');
  assert.equal(JSON.stringify(result).includes(f.root), false);
});

test('último uso é informado quando disponível, sem inventar data ausente', async t => {
  const f = await fixture(t, { readLastUsed: async bundle => bundle.includes('Recente') ? '2026-10-01T10:00:00.000Z' : null });
  await f.app('Recente'); await f.app('SemData');
  const result = await f.manager.list();
  assert.equal(result.items.find(item => item.name === 'Recente').lastUsedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(result.items.find(item => item.name === 'SemData').lastUsedAt, null);
});

test('apps em subpastas podem ser revisados, sem percorrer helpers dentro de bundles', async t => {
  const f = await fixture(t);
  const folder = path.join(f.root,'Utilities'); await fs.mkdir(folder);
  const bundle = await f.app('Utilitario', {}, folder);
  await f.app('HelperInterno', {}, path.join(bundle,'Contents'));
  const result = await f.manager.list();
  assert.deepEqual(result.items.map(item => item.name), ['Utilitario']);
  const prepared = await f.manager.prepare(result.items[0].id);
  assert.equal(prepared.ok, true);
});

test('raiz de apps do macOS aparece na lista e nunca autoriza desinstalação', async t => {
  const f = await fixture(t);
  const systemRoot = path.join(f.base,'SystemApplications'); await fs.mkdir(systemRoot);
  const bundle = await f.app('AppDoMac', { CFBundleIdentifier:'com.fixture.macos' }, systemRoot);
  const manager = create({ ...f.options, readOnlyRoots:[systemRoot] });
  const item = (await manager.list()).items[0];
  assert.equal(item.name,'AppDoMac'); assert.equal(item.canUninstall,false); assert.equal(item.protected,true);
  assert.equal((await manager.prepare(item.id)).ok,false);
  assert.equal(await manager.pathFor(item.id),bundle);
  assert.deepEqual(f.moved,[]);
});

test('subpastas por symlink não expandem a lista nem permitem remoção externa', async t => {
  const f = await fixture(t);
  const outside=path.join(f.base,'Other');await fs.mkdir(outside);
  await f.app('Externo',{},outside);await fs.symlink(outside,path.join(f.root,'Atalho'));
  assert.equal((await f.manager.list()).items.length,0);
});

test('preparação mede bundle e confirmação move só o bundle à Lixeira', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  const preferences = path.join(f.base, 'preferences.json');
  await fs.writeFile(preferences, 'dados que devem permanecer');
  const item = await f.selected();
  const prepared = await f.manager.prepare(item.id);
  assert.ok(prepared.bytes > 0);
  assert.match(prepared.details, /preferências.*mantidos/);
  const result = await f.manager.uninstall({ id: item.id, token: prepared.token, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.ok, true);
  assert.equal(result.movedToTrash, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(f.moved, [bundle]);
  assert.equal(await fs.readFile(preferences, 'utf8'), 'dados que devem permanecer');
  assert.equal(await f.manager.pathFor(item.id), null);
});

test('simulação revisa tudo e não chama a Lixeira; token só pode ser usado uma vez', async t => {
  const f = await fixture(t);
  await f.app();
  const item = await f.selected();
  const request = { ...await f.consent(item), expectedDryRun: true };
  const result = await f.manager.uninstall(request, { dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.movedToTrash, false);
  assert.equal(result.dryRun, true);
  assert.deepEqual(f.moved, []);
  assert.equal((await f.manager.uninstall(request, { dryRun: true })).code, 'INVALID_CONFIRMATION');
});

test('modo alterado, ausente ou diferente recusa e consome a confirmação', async t => {
  const f = await fixture(t);
  await f.app();
  const item = await f.selected();
  for (const [expectedDryRun, config] of [[true, { dryRun: false }], [false, { dryRun: true }], [false, {}], [undefined, { dryRun: false }]]) {
    const request = { ...await f.consent(item), expectedDryRun };
    assert.equal((await f.manager.uninstall(request, config)).code, 'MODE_CHANGED');
    assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'INVALID_CONFIRMATION');
  }
  assert.deepEqual(f.moved, []);
});

test('recusa caminhos fornecidos, IDs inventados, troca de ID e token expirado', async t => {
  let now = 100;
  const f = await fixture(t, { now: () => now, tokenTtlMs: 100 });
  const bundle = await f.app();
  await f.app('Outro');
  const result = await f.manager.list();
  const [first, second] = result.items;
  assert.equal((await f.manager.prepare(bundle)).code, 'UNKNOWN_APP');
  assert.equal((await f.manager.prepare('../qualquer')).code, 'UNKNOWN_APP');
  let request = await f.consent(first);
  assert.equal((await f.manager.uninstall({ ...request, id: second.id }, { dryRun: false })).code, 'INVALID_CONFIRMATION');
  request = await f.consent(first);
  now = 201;
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'INVALID_CONFIRMATION');
  assert.deepEqual(f.moved, []);
});

test('atualizar a lista invalida todas as confirmações anteriores', async t => {
  const f = await fixture(t);
  await f.app();
  const item = await f.selected();
  const request = await f.consent(item);
  await f.manager.list();
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'INVALID_CONFIRMATION');
  assert.deepEqual(f.moved, []);
});

test('protege Apple, CalangoClean, próprio bundle e aplicativos com helpers privilegiados', async t => {
  const f = await fixture(t);
  await f.app('Safari', { CFBundleIdentifier: 'com.apple.Safari' });
  await f.app('CalangoClean', { CFBundleIdentifier: 'com.outro.qualquer' });
  await f.app('OutroCalango', { CFBundleIdentifier: 'com.sejacalango.calangoclean' });
  await f.app('VPN', { SMPrivilegedExecutables: { helper: 'requirement' } });
  await f.app('Uninstaller');
  const self = await f.app('MeMesmo');
  const manager = create({ ...f.options, selfPath: path.join(self, 'Contents', 'Resources', 'app.asar') });
  const result = await manager.list();
  assert.equal(result.items.length, 6);
  for (const item of result.items) {
    assert.equal(item.canUninstall, false, item.name);
    assert.equal(item.protected, true, item.name);
    assert.equal((await manager.prepare(item.id)).code, 'PROTECTED', item.name);
  }
  assert.deepEqual(f.moved, []);
});

test('recusa bundles com metadados inválidos, plist por symlink/hardlink e executável por symlink', async t => {
  const f = await fixture(t);
  await f.app('InvalidId', { CFBundleIdentifier: '../escape' });
  await f.app('InvalidExec', { CFBundleExecutable: '../../bin' });
  await f.app('NotApp', { CFBundlePackageType: 'BNDL' });
  const linked = await f.app('LinkedPlist');
  const plist = path.join(linked, 'Contents', 'Info.plist');
  const external = path.join(f.base, 'plist.json');
  await fs.rename(plist, external);
  await fs.symlink(external, plist);
  const hardlinked = await f.app('HardlinkedPlist');
  await fs.link(path.join(hardlinked, 'Contents', 'Info.plist'), path.join(f.base, 'hardlink'));
  const linkedExec = await f.app('LinkedExec');
  const exec = path.join(linkedExec, 'Contents', 'MacOS', 'binary');
  await fs.unlink(exec);
  await fs.symlink(external, exec);
  const list = await f.manager.list();
  assert.equal(list.items.length, 6);
  for (const item of list.items) assert.equal(item.canUninstall, false, item.name);
  assert.deepEqual(f.moved, []);
});

test('recusa raiz e bundle por symlink, mantendo alvos externos intactos', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  await fs.symlink(bundle, path.join(f.root, 'Atalho.app'));
  const result = await f.manager.list();
  const link = result.items.find(item => item.name === 'Atalho');
  assert.equal(link.canUninstall, false);
  assert.equal(await f.manager.pathFor(link.id), null);
  const rootLink = path.join(f.base, 'AppsLink');
  await fs.symlink(f.root, rootLink);
  const manager = create({ ...f.options, roots: [rootLink] });
  const list = await manager.list();
  assert.deepEqual(list.items, []);
  assert.equal(list.errors.length, 1);
  assert.deepEqual(f.moved, []);
});

test('não percorre links internos e não contabiliza dados externos', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  const outside = path.join(f.base, 'personal');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'large'), Buffer.alloc(40000));
  await fs.symlink(outside, path.join(bundle, 'Contents', 'Outside'));
  const item = await f.selected();
  const prepared = await f.manager.prepare(item.id);
  assert.equal(prepared.ok, true);
  assert.ok(prepared.bytes < 1000);
  const result = await f.manager.uninstall({ id: item.id, token: prepared.token, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.ok, true);
  assert.equal((await fs.stat(path.join(outside, 'large'))).size, 40000);
});

test('aplicativo aberto é bloqueado na lista, preparação e imediatamente antes da Lixeira', async t => {
  let running = true;
  let reads = 0;
  const f = await fixture(t, { isRunning: async () => { reads++; return running; } });
  await f.app();
  const item = await f.selected();
  assert.equal(item.running, true);
  assert.equal(item.canUninstall, false);
  assert.equal((await f.manager.prepare(item.id)).code, 'RUNNING');
  running = false;
  let request = await f.consent(item);
  running = true;
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'RUNNING');
  // review() verifica uma vez; o segundo teste ocorre após o hash, antes do trashItem.
  let finalReads = 0;
  const other = create({ ...f.options, isRunning: async () => ++finalReads >= 4 });
  const otherItem = (await other.list()).items[0];
  const prep = await other.prepare(otherItem.id);
  assert.equal(prep.ok, true);
  assert.equal((await other.uninstall({ id: otherItem.id, token: prep.token, expectedDryRun: false }, { dryRun: false })).code, 'RUNNING');
  assert.equal(finalReads, 4);
  assert.deepEqual(f.moved, []);
});

test('detecção por processo usa limite de bundle, incluindo nomes com espaços', async t => {
  const f = await fixture(t);
  const bundle = await f.app('Nome com espaço');
  let processes = [`${bundle}.backup/Contents/MacOS/binary`, `${bundle}Extra/Contents/MacOS/binary`];
  const manager = create({ ...f.options, isRunning: undefined, listProcesses: async () => processes });
  let item = (await manager.list()).items[0];
  assert.equal(item.running, false);
  processes = [`${bundle}/Contents/MacOS/binary`];
  assert.equal((await manager.prepare(item.id)).code, 'RUNNING');
  item = (await manager.list()).items[0];
  assert.equal(item.running, true);
  assert.deepEqual(f.moved, []);
});

test('falha ao verificar processos bloqueia a operação sem assumir aplicativo fechado', async t => {
  const f = await fixture(t);
  await f.app();
  const manager = create({ ...f.options, isRunning: undefined, listProcesses: async () => { throw new Error('ps failed'); } });
  const item = (await manager.list()).items[0];
  assert.equal(item.canUninstall, false);
  assert.match(item.reason, /verificar os aplicativos abertos/);
  assert.equal((await manager.prepare(item.id)).ok, false);
  assert.deepEqual(f.moved, []);
});

test('troca de inode, conteúdo e identidade da raiz após confirmação são recusadas', async t => {
  const f = await fixture(t);
  let bundle = await f.app();
  let item = await f.selected();
  let request = await f.consent(item);
  await fs.rename(bundle, path.join(f.base, 'Old.app'));
  bundle = await f.app();
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'CHANGED');
  item = await f.selected();
  request = await f.consent(item);
  await fs.appendFile(path.join(bundle, 'Contents', 'MacOS', 'binary'), 'changed');
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'CHANGED');
  item = await f.selected();
  request = await f.consent(item);
  await fs.rename(f.root, path.join(f.base, 'OldApplications'));
  await fs.mkdir(f.root);
  await f.app();
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'CHANGED');
  assert.deepEqual(f.moved, []);
});

test('substituir bundle por symlink após preparar nunca move o alvo', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  const item = await f.selected();
  const request = await f.consent(item);
  const outside = path.join(f.base, 'Outside.app');
  await fs.rename(bundle, outside);
  await fs.symlink(outside, bundle);
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).ok, false);
  assert.equal(await f.manager.pathFor(item.id), null);
  assert.deepEqual(f.moved, []);
  assert.equal((await fs.stat(outside)).isDirectory(), true);
});

test('extensões de sistema, árvores excessivas e falha na Lixeira fornecem erros honestos', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  await fs.mkdir(path.join(bundle, 'Contents', 'driver.systemextension'));
  const item = await f.selected();
  assert.equal((await f.manager.prepare(item.id)).code, 'PROTECTED');
  await fs.rmdir(path.join(bundle, 'Contents', 'driver.systemextension'));
  const small = create({ ...f.options, maxEntries: 2 });
  const smallItem = (await small.list()).items[0];
  assert.equal((await small.prepare(smallItem.id)).code, 'TOO_LARGE');
  const failing = create({ ...f.options, trashItem: async () => { throw new Error('failure containing a private path'); } });
  const failingItem = (await failing.list()).items[0];
  const prepared = await failing.prepare(failingItem.id);
  const result = await failing.uninstall({ id: failingItem.id, token: prepared.token, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.code, 'TRASH_FAILED');
  assert.equal(result.error.includes('private path'), false);
  assert.equal((await fs.stat(bundle)).isDirectory(), true);
  assert.deepEqual(f.moved, []);
});

test('não roda duas operações de Lixeira em paralelo', async t => {
  let release;
  let entered;
  const didEnter = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { trashItem: async () => { entered(); await wait; } });
  await f.app();
  await f.app('Outro');
  const items = (await f.manager.list()).items;
  const first = await f.consent(items[0]);
  const second = await f.consent(items[1]);
  const running = f.manager.uninstall(first, { dryRun: false });
  await didEnter;
  assert.equal((await f.manager.uninstall(second, { dryRun: false })).code, 'BUSY');
  assert.equal((await f.manager.list()).code, 'BUSY');
  release();
  assert.equal((await running).ok, true);
});

test('mudança da pasta raiz sem troca do inode também exige nova revisão', async t => {
  const f = await fixture(t);
  await f.app();
  const item = await f.selected();
  const request = await f.consent(item);
  await fs.writeFile(path.join(f.root, 'nova-entrada'), 'mudou');
  assert.equal((await f.manager.uninstall(request, { dryRun: false })).code, 'CHANGED');
  assert.deepEqual(f.moved, []);
});

test('troca de identidade na última verificação de processo ainda é recusada', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  let checks = 0;
  const manager = create({ ...f.options, isRunning: async () => {
    if (++checks === 4) {
      await fs.rename(bundle, path.join(f.base, 'Retirado.app'));
      await f.app();
    }
    return false;
  } });
  const item = (await manager.list()).items[0];
  const prepared = await manager.prepare(item.id);
  const result = await manager.uninstall({ id: item.id, token: prepared.token, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.code, 'CHANGED');
  assert.equal(checks, 4);
  assert.deepEqual(f.moved, []);
});

test('permissão negada pela Lixeira não tenta sudo nem remoção alternativa', async t => {
  const f = await fixture(t);
  const bundle = await f.app();
  let attempts = 0;
  const manager = create({ ...f.options, trashItem: async () => {
    attempts++;
    throw Object.assign(new Error('private path'), { code: 'EACCES' });
  } });
  const item = (await manager.list()).items[0];
  const prepared = await manager.prepare(item.id);
  const result = await manager.uninstall({ id: item.id, token: prepared.token, expectedDryRun: false }, { dryRun: false });
  assert.equal(result.code, 'EACCES');
  assert.equal(attempts, 1);
  assert.match(result.error, /Sem permissão/);
  assert.equal((await fs.stat(bundle)).isDirectory(), true);
  assert.deepEqual(f.moved, []);
});
