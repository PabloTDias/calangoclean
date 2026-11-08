const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { create } = require('../src/photoDuplicates');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFL8AAAAASUVORK5CYII=', 'base64');
const photoBytes = (content = 'same image') => Buffer.concat([PNG, Buffer.from(content)]);
const plainMetadata = async () => ({ eligible: true, fingerprint: 'plain-photo' });
const exists = async target => {
  try { await fs.lstat(target); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

async function fixture(t, overrides = {}) {
  // Every read/write and fake Trash operation stays inside this disposable fixture.
  const home = await fs.mkdtemp(path.join(__dirname, '.photo-duplicates-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await Promise.all(['Pictures', 'Downloads', 'Documents', 'Desktop', '.fake-trash'].map(name => fs.mkdir(path.join(home, name))));
  const moved = [];
  const write = async (relative, content = 'same image') => {
    const target = path.join(home, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.isBuffer(content) ? content : photoBytes(content));
    return target;
  };
  const fakeTrash = async target => {
    assert.ok(target.startsWith(home + path.sep), 'must never move a personal file');
    const destination = path.join(home, '.fake-trash', `${moved.length}-${path.basename(target)}`);
    await fs.rename(target, destination);
    moved.push({ target, destination });
  };
  const service = create({ home, inspectMetadata: plainMetadata, trashItem: fakeTrash, ...overrides });
  const scan = async (rootIds = ['downloads', 'pictures']) => {
    await service.scan(rootIds);
    return service.snapshot();
  };
  return { home, write, service, scan, moved, fakeTrash };
}

const files = snapshot => snapshot.groups.flatMap(group => group.files);
const fileNamed = (snapshot, name) => files(snapshot).find(file => file.name === name);
const selection = (snapshot, ...names) => ({ scanId: snapshot.scanId, ids: names.map(name => {
  const file = fileNamed(snapshot, name);
  assert.ok(file, `expected duplicate ${name}`);
  return file.id;
}) });

test('agrupa fotos com os mesmos bytes mesmo com nomes e pastas diferentes', async t => {
  const f = await fixture(t);
  await f.write('Downloads/camera.png');
  await f.write('Pictures/viagem/copy.png');
  await f.write('Downloads/outra.png', 'different image');
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 1);
  assert.deepEqual(files(snapshot).map(file => file.name).sort(), ['camera.png', 'copy.png']);
  assert.ok(snapshot.scanId);
  assert.equal(f.moved.length, 0, 'scan must never move files');
});

test('nome e tamanho iguais não tornam conteúdos diferentes em duplicados', async t => {
  const f = await fixture(t);
  await f.write('Downloads/one/photo.png', 'AAAA');
  await f.write('Downloads/two/photo.png', 'BBBB');
  await f.write('Downloads/renamed.png', 'CCCC');
  assert.equal((await f.scan()).groups.length, 0);
});

test('texto ou binário renomeado como imagem não vira candidato', async t => {
  const f = await fixture(t);
  await f.write('Downloads/one.png', Buffer.from('this is not a photo'));
  await f.write('Downloads/two.png', Buffer.from('this is not a photo'));
  await f.write('Downloads/one.dll', photoBytes());
  await f.write('Downloads/two.dll', photoBytes());
  assert.equal((await f.scan()).groups.length, 0);
});

test('não segue links de arquivo nem de pasta e recusa raiz com symlink no caminho', async t => {
  const f = await fixture(t);
  const original = await f.write('Documents/private/original.png');
  await fs.symlink(original, path.join(f.home, 'Downloads', 'linked.png'));
  await fs.symlink(path.dirname(original), path.join(f.home, 'Downloads', 'linked-folder'));
  await fs.symlink(path.join(f.home, 'Documents'), path.join(f.home, 'alias-documents'));
  await assert.rejects(f.service.addRoot(path.join(f.home, 'alias-documents')));
  await assert.rejects(f.service.addRoot(path.join(f.home, 'alias-documents', 'private')));
  assert.equal((await f.scan()).groups.length, 0);
  assert.equal(await exists(original), true);
});

test('raiz padrão redirecionada por link é recusada sem ler os arquivos de destino', async t => {
  const f = await fixture(t);
  await f.write('Documents/original.png');
  await f.write('Documents/copy.png');
  await fs.rmdir(path.join(f.home, 'Pictures'));
  await fs.symlink(path.join(f.home, 'Documents'), path.join(f.home, 'Pictures'));
  assert.equal((await f.scan(['pictures'])).groups.length, 0);
});

test('hardlinks não são oferecidos como cópias independentes', async t => {
  const f = await fixture(t);
  const original = await f.write('Downloads/original.png');
  await fs.link(original, path.join(f.home, 'Downloads', 'hardlink.png'));
  await f.write('Downloads/independent.png');
  assert.equal((await f.scan()).groups.length, 0);
});

test('não entra em bibliotecas, apps, projetos, backups, nuvem e diretórios ocultos', async t => {
  const f = await fixture(t);
  const dirs = [
    'Pictures/Photos.photoslibrary/originals',
    'Downloads/Tool.app/Contents/Resources',
    'Downloads/Document.pages/Data',
    'Downloads/Document.rtfd',
    'Pictures/Project.fcpbundle/Original Media',
    'Downloads/project-with-git/.git',
    'Downloads/node-project',
    'Downloads/.hidden',
    'Library/Application Support/app',
    'Library/CloudStorage/provider',
    'Downloads/Backups.backupdb/Mac',
  ];
  for (const dir of dirs) {
    await f.write(`${dir}/a.png`);
    await f.write(`${dir}/b.png`);
  }
  await f.write('Downloads/project-with-git/image.png');
  await f.write('Downloads/node-project/package.json', Buffer.from('{}'));
  await f.write('Downloads/local-library/Library/a.png');
  await f.write('Downloads/local-library/Library/b.png');
  assert.equal((await f.scan()).groups.length, 0);
  for (const dir of ['Library', 'Library/CloudStorage/provider', 'Pictures/Photos.photoslibrary', 'Downloads/Tool.app', 'Downloads/node-project']) {
    await assert.rejects(f.service.addRoot(path.join(f.home, dir)), `must refuse root ${dir}`);
  }
});

test('recusa caminhos fora da home e escapes por prefixo semelhante ou travessia', async t => {
  const f = await fixture(t);
  for (const target of [f.home, path.dirname(f.home), '/System', '/Library', '/private', '/Volumes', path.join(f.home, '..', 'outside'), f.home + '-other']) {
    await assert.rejects(f.service.addRoot(target), `must refuse ${target}`);
  }
  await assert.rejects(f.service.scan(['../Downloads']));
});

test('fotos com pares Live Photo ou sidecars não são tratadas como fotos soltas', async t => {
  const f = await fixture(t);
  await f.write('Downloads/live-one.png');
  await f.write('Downloads/live-two.png');
  await f.write('Downloads/live-one.mov', Buffer.from('paired movie'));
  await f.write('Downloads/live-two.mov', Buffer.from('paired movie'));
  await f.write('Pictures/raw-one.png');
  await f.write('Pictures/raw-two.png');
  await f.write('Pictures/raw-one.xmp', Buffer.from('sidecar'));
  await f.write('Pictures/raw-two.xmp', Buffer.from('sidecar'));
  await f.write('Downloads/edited-one.png');
  await f.write('Downloads/edited-two.png');
  await f.write('Downloads/edited-one.png.xmp', Buffer.from('sidecar'));
  await f.write('Downloads/edited-two.png.xmp', Buffer.from('sidecar'));
  assert.equal((await f.scan()).groups.length, 0);
});

test('raízes aninhadas não contam o mesmo caminho como duas cópias', async t => {
  const f = await fixture(t);
  await f.write('Downloads/folder/one.png');
  await f.service.addRoot(path.join(f.home, 'Downloads', 'folder'));
  const snapshot = await f.scan(f.service.roots().map(root => root.id));
  assert.equal(snapshot.groups.length, 0);
});

test('metadados rejeitados ou distintos impedem tratar duas fotos como equivalentes', async t => {
  const f = await fixture(t, { inspectMetadata: async target => ({
    eligible: !target.endsWith('blocked.png'),
    fingerprint: target.includes('/Pictures/') ? 'resource-fork-A' : 'resource-fork-B',
    reason: 'Metadados protegidos',
  }) });
  await f.write('Pictures/one.png');
  await f.write('Downloads/two.png');
  await f.write('Pictures/blocked.png');
  assert.equal((await f.scan()).groups.length, 0);
});

test('envia somente a foto selecionada à Lixeira fake e preserva a outra cópia', async t => {
  const f = await fixture(t);
  const original = await f.write('Downloads/original.png');
  const copy = await f.write('Pictures/copy.png');
  const snapshot = await f.scan();
  const result = await f.service.trash({ ...selection(snapshot, 'copy.png'), dryRun: false });
  assert.equal(result.movedCount, 1);
  assert.equal(result.results[0].status, 'moved');
  assert.equal(await exists(original), true);
  assert.equal(await exists(copy), false);
  assert.equal(f.moved.length, 1);
  assert.deepEqual(await fs.readFile(f.moved[0].destination), photoBytes());
});

test('simulação valida seleção mas nunca chama a Lixeira', async t => {
  const f = await fixture(t);
  const original = await f.write('Downloads/original.png');
  const copy = await f.write('Pictures/copy.png');
  const snapshot = await f.scan();
  const result = await f.service.trash({ ...selection(snapshot, 'copy.png'), dryRun: true });
  assert.equal(result.movedCount, 0);
  assert.equal(result.simulatedCount, 1);
  assert.equal(result.selectedBytes, photoBytes().length);
  assert.equal(await exists(original), true);
  assert.equal(await exists(copy), true);
  assert.equal(f.moved.length, 0);
});

test('recusa selecionar todas as cópias e mantém o grupo inteiro', async t => {
  const f = await fixture(t);
  const one = await f.write('Downloads/one.png');
  const two = await f.write('Pictures/two.png');
  const snapshot = await f.scan();
  await assert.rejects(f.service.trash({ scanId: snapshot.scanId, ids: files(snapshot).map(file => file.id), dryRun: false }));
  assert.equal(await exists(one), true);
  assert.equal(await exists(two), true);
  assert.equal(f.moved.length, 0);
});

test('cópia preservada alterada depois da análise impede mover a seleção', async t => {
  const f = await fixture(t);
  const keeper = await f.write('Downloads/keeper.png');
  const selected = await f.write('Pictures/selected.png');
  const snapshot = await f.scan();
  await fs.writeFile(keeper, photoBytes('changed photo'));
  const result = await f.service.trash({ ...selection(snapshot, 'selected.png'), dryRun: false });
  assert.equal(result.movedCount, 0);
  assert.equal(result.results[0].status, 'skipped');
  assert.equal(await exists(selected), true);
  assert.equal(f.moved.length, 0);
});

test('substituição de selecionado com mesmo tamanho e mtime não reaproveita autorização antiga', async t => {
  const f = await fixture(t);
  await f.write('Downloads/keeper.png', 'AAAA');
  const selected = await f.write('Pictures/selected.png', 'AAAA');
  const snapshot = await f.scan();
  const before = await fs.stat(selected);
  await fs.unlink(selected);
  await fs.writeFile(selected, photoBytes('BBBB'));
  await fs.utimes(selected, before.atime, before.mtime);
  const result = await f.service.trash({ ...selection(snapshot, 'selected.png'), dryRun: false });
  assert.equal(result.movedCount, 0);
  assert.equal(await exists(selected), true);
  assert.equal(f.moved.length, 0);
});

test('IDs desconhecidos e análises antigas não autorizam mover nenhum arquivo', async t => {
  const f = await fixture(t);
  const one = await f.write('Downloads/one.png');
  const two = await f.write('Pictures/two.png');
  const old = await f.scan();
  const oldSelection = selection(old, 'two.png');
  const fresh = await f.scan();
  assert.notEqual(old.scanId, fresh.scanId);
  await assert.rejects(f.service.trash({ ...oldSelection, dryRun: false }));
  await assert.rejects(f.service.trash({ scanId: fresh.scanId, ids: ['../../some-file'], dryRun: false }));
  await assert.rejects(f.service.safeFile('unknown-id'));
  assert.equal(await exists(one), true);
  assert.equal(await exists(two), true);
  assert.equal(f.moved.length, 0);
});

test('falha em mover uma foto não causa exclusão permanente nem esconde sucesso parcial', async t => {
  let fixtureHome;
  const f = await fixture(t, { trashItem: async target => {
    assert.ok(target.startsWith(fixtureHome + path.sep));
    if (target.endsWith('fail.png')) throw new Error('Lixeira indisponível');
    await fs.rename(target, path.join(fixtureHome, '.fake-trash', path.basename(target)));
  } });
  fixtureHome = f.home;
  const keeper = await f.write('Downloads/keeper.png');
  const good = await f.write('Pictures/good.png');
  const failed = await f.write('Pictures/fail.png');
  const snapshot = await f.scan();
  const result = await f.service.trash({ ...selection(snapshot, 'good.png', 'fail.png'), dryRun: false });
  assert.equal(result.movedCount, 1);
  assert.deepEqual(result.results.map(item => item.status).sort(), ['moved', 'skipped']);
  assert.match(result.results.find(item => item.status === 'skipped').reason, /Lixeira indisponível/);
  assert.equal(await exists(keeper), true);
  assert.equal(await exists(failed), true);
  assert.equal(await exists(good), false);
});

test('cancelar a análise invalida resultados parciais e a seleção anterior', async t => {
  let cancelOnProgress = false;
  let service;
  const f = await fixture(t, { onProgress: async () => {
    if (cancelOnProgress) service.cancel();
  } });
  service = f.service;
  await f.write('Downloads/one.png');
  await f.write('Pictures/two.png');
  const previous = await f.scan();
  cancelOnProgress = true;
  await f.service.scan(['downloads', 'pictures']);
  assert.equal(f.service.snapshot().groups.length, 0);
  await assert.rejects(f.service.trash({ ...selection(previous, 'two.png'), dryRun: false }));
  assert.equal(f.moved.length, 0);
});

test('análise em andamento recusa nova análise e descarte de resultados anteriores', async t => {
  let hold = false;
  let entered;
  let release;
  const pending = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { inspectMetadata: async () => {
    if (hold) { hold = false; entered(); await gate; }
    return { eligible: true, fingerprint: 'plain-photo' };
  } });
  await f.write('Downloads/one.png');
  await f.write('Pictures/two.png');
  const previous = await f.scan();
  hold = true;
  const active = f.service.scan(['downloads', 'pictures']);
  await pending;
  try {
    await assert.rejects(f.service.scan(['downloads']));
    await assert.rejects(f.service.trash({ ...selection(previous, 'two.png'), dryRun: false }));
    assert.equal(f.moved.length, 0);
  } finally { release(); await active; }
});

test('descarte em andamento bloqueia nova análise e outro descarte', async t => {
  let entered;
  let release;
  let fixtureHome;
  const pending = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { trashItem: async target => {
    assert.ok(target.startsWith(fixtureHome + path.sep));
    entered();
    await gate;
    await fs.rename(target, path.join(fixtureHome, '.fake-trash', path.basename(target)));
  } });
  fixtureHome = f.home;
  const keeper = await f.write('Downloads/keeper.png');
  await f.write('Pictures/copy.png');
  const snapshot = await f.scan();
  const request = { ...selection(snapshot, 'copy.png'), dryRun: false };
  const active = f.service.trash(request);
  await pending;
  try {
    await assert.rejects(f.service.scan(['downloads']));
    await assert.rejects(f.service.trash(request));
  } finally { release(); await active; }
  assert.equal(await exists(keeper), true);
});

test('revalida a cópia preservada entre envios e interrompe se ela desaparecer', async t => {
  let fixtureHome;
  let keeper;
  let calls = 0;
  const f = await fixture(t, { trashItem: async target => {
    assert.ok(target.startsWith(fixtureHome + path.sep));
    await fs.rename(target, path.join(fixtureHome, '.fake-trash', path.basename(target)));
    calls++;
    if (calls === 1) await fs.unlink(keeper);
  } });
  fixtureHome = f.home;
  keeper = await f.write('Downloads/keeper.png');
  await f.write('Pictures/first.png');
  await f.write('Pictures/last.png');
  const snapshot = await f.scan();
  const result = await f.service.trash({ ...selection(snapshot, 'first.png', 'last.png'), dryRun: false });
  assert.equal(result.movedCount, 1);
  assert.equal(result.results.filter(item => item.status === 'skipped').length, 1);
  assert.equal(await exists(result.results.find(item => item.status === 'skipped').path), true);
  assert.equal(calls, 1);
});

test('falha na leitura dos metadados não libera uma foto para descarte', async t => {
  const f = await fixture(t, { inspectMetadata: async () => { throw new Error('Sem permissão para ler atributos'); } });
  const one = await f.write('Downloads/one.png');
  const two = await f.write('Pictures/two.png');
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 0);
  assert.ok(snapshot.stats.errors > 0);
  assert.equal(await exists(one), true);
  assert.equal(await exists(two), true);
  assert.equal(f.moved.length, 0);
});
