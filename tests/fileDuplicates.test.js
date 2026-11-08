const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { create } = require('../src/photoDuplicates');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFL8AAAAASUVORK5CYII=', 'base64');
const bytes = (header, label = 'duplicate fixture') => Buffer.concat([Buffer.isBuffer(header) ? header : Buffer.from(header), Buffer.from(label)]);
const PDF = bytes('%PDF-1.7\n', 'safe personal document\n%%EOF');
const VIDEO = bytes(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]), 'personal video');
const WAV = bytes('RIFF0000WAVE', 'personal recording');
const ZIP = bytes(Buffer.from([80, 75, 3, 4]), 'opaque archive fixture; never extracted');
const plainMetadata = async () => ({ eligible: true, fingerprint: 'plain-file' });
const allFiles = snapshot => snapshot.groups.flatMap(group => group.files);
const selection = (snapshot, ...names) => ({ scanId: snapshot.scanId, ids: names.map(name => {
  const file = allFiles(snapshot).find(item => item.name === name);
  assert.ok(file, `expected duplicate ${name}`);
  return file.id;
}) });
const exists = async filename => {
  try { await fs.lstat(filename); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

async function monitoredFactory(reads) {
  const filename = require.resolve('../src/photoDuplicates');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, Buffer, process,
    require: id => id === 'node:fs/promises' ? { ...fs, open: async (...args) => { reads.push(args[0]); return fs.open(...args); } } : localRequire(id),
  }, { filename });
  return module.exports.create;
}

async function fixture(t, overrides = {}, serviceFactory = create) {
  // The only files read, renamed or removed by these tests belong to this fixture.
  const home = await fs.mkdtemp(path.join(__dirname, '.file-duplicates-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await Promise.all(['Downloads', 'Documents', 'Desktop', 'Movies', 'Music', 'Pictures', '.fake-trash'].map(name => fs.mkdir(path.join(home, name))));
  const moved = [];
  const write = async (relative, content = PDF) => {
    const filename = path.join(home, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
    return filename;
  };
  const fakeTrash = async filename => {
    assert.ok(filename.startsWith(home + path.sep), 'must never move a personal file');
    const target = path.join(home, '.fake-trash', `${moved.length}-${path.basename(filename)}`);
    await fs.rename(filename, target);
    moved.push({ filename, target });
  };
  const service = serviceFactory({ home, mode: 'files', inspectMetadata: plainMetadata, trashItem: fakeTrash, ...overrides });
  const scan = async (rootIds = ['downloads', 'documents']) => {
    await service.scan(rootIds);
    return service.snapshot();
  };
  return { home, moved, write, service, scan, fakeTrash };
}

test('modo arquivos tem raízes pessoais próprias e rejeita modos desconhecidos', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.service.roots().map(root => root.id).sort(), ['desktop', 'documents', 'downloads', 'movies', 'music']);
  assert.equal(f.service.snapshot().mode, 'files');
  assert.throws(() => create({ mode: 'system' }), /modo/i);
});

for (const [extension, kind, content] of [
  ['pdf', 'document', PDF],
  ['txt', 'document', Buffer.from('Notas pessoais em UTF-8: férias, música e reunião.\n')],
  ['csv', 'document', Buffer.from('produto,quantidade\nCafé,2\n')],
  ['docx', 'document', bytes(Buffer.from([80, 75, 3, 4]), 'personal Word document')],
  ['zip', 'archive', ZIP],
  ['mp3', 'audio', bytes('ID3', 'personal song')],
  ['wav', 'audio', WAV],
  ['mp4', 'video', VIDEO],
]) {
  test(`agrupa ${extension.toUpperCase()} por conteúdo integral e informa tipo para a interface`, async t => {
    const f = await fixture(t);
    await f.write(`Downloads/original.${extension}`, content);
    await f.write(`Documents/renamed.${extension}`, content);
    const snapshot = await f.scan();
    assert.equal(snapshot.mode, 'files');
    assert.equal(snapshot.groups.length, 1);
    assert.equal(allFiles(snapshot).length, 2);
    assert.ok(allFiles(snapshot).every(file => file.kind === kind && file.extension === `.${extension}`));
    assert.equal(f.moved.length, 0, 'comparison never moves or executes a file');
  });
}

test('nome e tamanho iguais com bytes diferentes não viram duplicatas de documentos', async t => {
  const f = await fixture(t);
  await f.write('Downloads/one/report.pdf', bytes('%PDF-1.7\n', 'AAAA'));
  await f.write('Documents/two/report.pdf', bytes('%PDF-1.7\n', 'BBBB'));
  assert.equal((await f.scan()).groups.length, 0);
});

test('modo arquivos não mistura fotos com documentos e o modo fotos continua separado', async t => {
  const f = await fixture(t);
  await f.write('Downloads/photo.png', PNG);
  await f.write('Documents/photo-copy.png', PNG);
  await f.write('Downloads/report.pdf');
  await f.write('Documents/report-copy.pdf');
  const snapshot = await f.scan();
  assert.deepEqual(allFiles(snapshot).map(file => file.name).sort(), ['report-copy.pdf', 'report.pdf']);
  const photos = create({ home: f.home, mode: 'photos', inspectMetadata: plainMetadata });
  const extra = await photos.addRoot(path.join(f.home, 'Documents'));
  const result = await photos.scan(['downloads', extra.id]);
  assert.equal(result.mode, 'photos');
  assert.deepEqual(allFiles(result).map(file => file.name).sort(), ['photo-copy.png', 'photo.png']);
});

test('DLLs, componentes de software e extensões fora da lista não são abertos nem comparados', async t => {
  const reads = [];
  const metadata = [];
  const serviceFactory = await monitoredFactory(reads);
  const f = await fixture(t, { inspectMetadata: async target => { metadata.push(target); return plainMetadata(); } }, serviceFactory);
  const disallowed = ['dll', 'dylib', 'so', 'exe', 'bin', 'sh', 'js', 'py', 'db', 'sqlite', 'json', 'plist', 'ttf', 'otf', 'dmg', 'pkg', 'docm', 'xlsm', 'pptm'];
  for (const ext of disallowed) {
    await f.write(`Downloads/one.${ext}`, PDF);
    await f.write(`Documents/two.${ext}`, PDF);
  }
  await f.write('Downloads/no-extension', PDF);
  await f.write('Documents/no-extension-copy', PDF);
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 0);
  assert.deepEqual(reads, [], 'prohibited extensions must not have their content opened');
  assert.deepEqual(metadata, [], 'prohibited extensions do not reach comparison metadata');
});

test('documentos dentro de extensões, plugins, serviços e instaladores de software nem são abertos', async t => {
  const reads = [];
  const metadata = [];
  const serviceFactory = await monitoredFactory(reads);
  const f = await fixture(t, { inspectMetadata: async target => { metadata.push(target); return plainMetadata(); } }, serviceFactory);
  const components = ['appex', 'xpc', 'component', 'vst', 'vst3', 'audiounit', 'qlgenerator', 'mdimporter', 'prefPane', 'saver', 'service', 'workflow', 'action', 'scptd', 'osax', 'driver', 'dSYM', 'pkg', 'mpkg'];
  for (const component of components) {
    // No 'Contents' or 'Resources' component: the package extension itself must
    // protect its descendants, even when the internal folder has a custom name.
    const root = `Downloads/Tool.${component}/Assets`;
    await f.write(`${root}/one.pdf`, PDF);
    await f.write(`${root}/two.pdf`, PDF);
    await f.write(`${root}/one.txt`, Buffer.from('software component data'));
    await f.write(`${root}/two.txt`, Buffer.from('software component data'));
    await assert.rejects(f.service.addRoot(path.join(f.home, root)), `must refuse .${component} package root`);
  }
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 0);
  assert.deepEqual(reads, [], 'component descendants must not be opened');
  assert.deepEqual(metadata, [], 'component descendants must not reach metadata comparison');
});

test('executáveis renomeados como PDF ou texto e arquivos com permissão executável são preservados', async t => {
  const f = await fixture(t);
  const headers = [Buffer.from('MZ'), Buffer.from([127, 69, 76, 70]), Buffer.from([207, 250, 237, 254]), Buffer.from([202, 254, 186, 190]), Buffer.from('#!/bin/sh\necho unsafe\n')];
  for (const [index, header] of headers.entries()) {
    await f.write(`Downloads/program-${index}.txt`, bytes(header));
    await f.write(`Documents/copy-${index}.txt`, bytes(header));
    await f.write(`Downloads/binary-${index}.pdf`, bytes(header));
    await f.write(`Documents/renamed-${index}.pdf`, bytes(header));
  }
  const first = await f.write('Downloads/launch.txt', Buffer.from('plain content'));
  const second = await f.write('Documents/launch-copy.txt', Buffer.from('plain content'));
  await fs.chmod(first, 0o755);
  await fs.chmod(second, 0o755);
  assert.equal((await f.scan()).groups.length, 0);
  assert.equal(f.moved.length, 0);
});

test('binário incompatível com a extensão permitida não vira documento, áudio ou arquivo compactado', async t => {
  const f = await fixture(t);
  for (const ext of ['pdf', 'zip', 'docx', 'mp3', 'wav', 'mp4']) {
    await f.write(`Downloads/fake.${ext}`, Buffer.from('not this format'));
    await f.write(`Documents/fake-copy.${ext}`, Buffer.from('not this format'));
  }
  assert.equal((await f.scan()).groups.length, 0);
});

test('texto é validado integralmente e não aceita binário escondido depois do primeiro bloco', async t => {
  const f = await fixture(t);
  const disguised = Buffer.concat([Buffer.alloc(300 * 1024, 65), Buffer.from([0, 1, 2, 3])]);
  await f.write('Downloads/not-text.txt', disguised);
  await f.write('Documents/not-text-copy.txt', disguised);
  assert.equal((await f.scan()).groups.length, 0);
});

test('texto UTF-8 com caractere dividido entre blocos continua sendo comparado corretamente', async t => {
  const f = await fixture(t);
  const content = Buffer.concat([Buffer.alloc(256 * 1024 - 1, 65), Buffer.from('é: fim do documento\n')]);
  await f.write('Downloads/large.txt', content);
  await f.write('Documents/large-copy.txt', content);
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 1);
  assert.equal(allFiles(snapshot).length, 2);
});

test('sistema, apps, fototecas, projetos, nuvem e pacotes continuam fora da busca de arquivos', async t => {
  const f = await fixture(t);
  for (const root of ['/System', '/Library', '/private', '/Volumes', f.home, path.join(f.home, '..', 'outside')]) {
    await assert.rejects(f.service.addRoot(root));
  }
  const protectedDirs = [
    'Downloads/Tool.app/Contents/Resources', 'Documents/Photos.photoslibrary/originals',
    'Documents/Report.pages/Data', 'Documents/.private', 'Documents/Library/Application Support/app',
    'Downloads/project', 'Downloads/DropBox', 'Downloads/OneDrive', 'Downloads/Backups.backupdb/Mac',
  ];
  for (const dir of protectedDirs) {
    await f.write(`${dir}/one.pdf`);
    await f.write(`${dir}/two.pdf`);
  }
  await f.write('Downloads/project/package.json', Buffer.from('{}'));
  assert.equal((await f.scan()).groups.length, 0);
});

test('links, hardlinks e ancestrais simbólicos não autorizam comparação ou descarte de arquivos', async t => {
  const f = await fixture(t);
  const original = await f.write('Documents/private/one.pdf');
  await fs.link(original, path.join(f.home, 'Downloads', 'hardlink.pdf'));
  await fs.symlink(original, path.join(f.home, 'Downloads', 'alias.pdf'));
  await fs.symlink(path.dirname(original), path.join(f.home, 'Downloads', 'linked-folder'));
  await f.write('Downloads/independent.pdf');
  await assert.rejects(f.service.addRoot(path.join(f.home, 'Downloads', 'linked-folder')));
  assert.equal((await f.scan()).groups.length, 0);
  assert.equal(await exists(original), true);
});

test('vídeos independentes entram, mas pares Live Photo e sidecars permanecem juntos', async t => {
  const f = await fixture(t);
  for (const name of ['live-one', 'live-two']) {
    await f.write(`Downloads/${name}.mov`, VIDEO);
    await f.write(`Downloads/${name}.jpg`, bytes(Buffer.from([255, 216, 255]), 'photo'));
  }
  for (const name of ['edited-one', 'edited-two']) {
    await f.write(`Documents/${name}.mp4`, VIDEO);
    await f.write(`Documents/${name}.mp4.xmp`, Buffer.from('sidecar'));
  }
  await f.write('Downloads/standalone.mov', VIDEO);
  await f.write('Documents/standalone-copy.mov', VIDEO);
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 1);
  assert.deepEqual(allFiles(snapshot).map(file => file.name).sort(), ['standalone-copy.mov', 'standalone.mov']);
});

test('arquivos compactados são comparados como blobs, sem extrair conteúdo nem criar arquivos', async t => {
  const f = await fixture(t);
  await f.write('Downloads/archive.zip', ZIP);
  await f.write('Documents/archive-copy.zip', ZIP);
  const beforeDownloads = await fs.readdir(path.join(f.home, 'Downloads'));
  const beforeDocuments = await fs.readdir(path.join(f.home, 'Documents'));
  const snapshot = await f.scan();
  assert.equal(snapshot.groups.length, 1);
  assert.deepEqual(await fs.readdir(path.join(f.home, 'Downloads')), beforeDownloads);
  assert.deepEqual(await fs.readdir(path.join(f.home, 'Documents')), beforeDocuments);
  assert.deepEqual(await fs.readFile(path.join(f.home, 'Downloads', 'archive.zip')), ZIP);
});

test('documentos exigem manter uma cópia e IDs de análises anteriores não podem ser usados', async t => {
  const f = await fixture(t);
  await f.write('Downloads/keeper.pdf');
  await f.write('Documents/copy.pdf');
  const old = await f.scan();
  await assert.rejects(f.service.trash({ scanId: old.scanId, ids: allFiles(old).map(file => file.id), dryRun: false }));
  const current = await f.scan();
  await assert.rejects(f.service.trash({ ...selection(old, 'copy.pdf'), dryRun: false }));
  await assert.rejects(f.service.trash({ scanId: current.scanId, ids: ['/System/file'], dryRun: false }));
  assert.equal(f.moved.length, 0);
});

test('simulação de arquivos preserva os blobs e uma alteração na cópia mantida bloqueia o envio real', async t => {
  const f = await fixture(t);
  const keeper = await f.write('Downloads/keeper.pdf');
  const copy = await f.write('Documents/copy.pdf');
  const snapshot = await f.scan();
  const request = selection(snapshot, 'copy.pdf');
  const simulated = await f.service.trash({ ...request, dryRun: true });
  assert.equal(simulated.simulatedCount, 1);
  assert.equal(f.moved.length, 0);
  assert.deepEqual(await fs.readFile(copy), PDF);
  await fs.writeFile(keeper, bytes('%PDF-1.7\n', 'changed document'));
  const blocked = await f.service.trash({ ...request, dryRun: false });
  assert.equal(blocked.movedCount, 0);
  assert.equal(blocked.skipped.length, 1);
  assert.equal(await exists(copy), true);
});

test('envio de documentos usa apenas Lixeira fake e não substitui falha por exclusão definitiva', async t => {
  let home;
  const f = await fixture(t, { trashItem: async filename => {
    assert.ok(filename.startsWith(home + path.sep));
    if (filename.endsWith('blocked.pdf')) throw new Error('Lixeira recusou este item');
    await fs.rename(filename, path.join(home, '.fake-trash', path.basename(filename)));
  } });
  home = f.home;
  const keeper = await f.write('Downloads/keeper.pdf');
  const moved = await f.write('Documents/good.pdf');
  const blocked = await f.write('Documents/blocked.pdf');
  const snapshot = await f.scan();
  const result = await f.service.trash({ ...selection(snapshot, 'good.pdf', 'blocked.pdf'), dryRun: false });
  assert.equal(result.movedCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /Lixeira recusou/);
  assert.equal(await exists(keeper), true);
  assert.equal(await exists(blocked), true);
  assert.equal(await exists(moved), false);
  assert.deepEqual(await fs.readFile(path.join(home, '.fake-trash', 'good.pdf')), PDF);
});

test('metadados de nuvem recusados preservam documentos mesmo quando os bytes coincidem', async t => {
  const f = await fixture(t, { inspectMetadata: async () => ({ eligible: false, fingerprint: '', reason: 'Arquivo gerenciado pela nuvem' }) });
  await f.write('Downloads/one.pdf');
  await f.write('Documents/two.pdf');
  assert.equal((await f.scan()).groups.length, 0);
  assert.equal(f.moved.length, 0);
});
