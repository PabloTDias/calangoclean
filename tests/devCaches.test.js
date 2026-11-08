const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const disk = require('../src/disk');
const { create } = require('../src/categories/devCaches');

// Somente pastas temporárias criadas pelo teste; os comandos de ferramentas
// nunca executam e nenhuma pasta de cache real do usuário é tocada.
async function fixture(t, { installed = ['brew', 'npm', 'pip3'], overrides = {} } = {}) {
  const root = await fs.mkdtemp(path.join(__dirname, '.dev-caches-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const cat = create({ home, diskTools: {
    ...disk,
    findCommand: async name => installed.includes(name) ? `/mock/bin/${name}` : null,
    runTool: async () => { throw new Error('não deve executar ferramentas para apagar caches'); },
    ...overrides,
  } });
  async function file(relative, content = Buffer.alloc(8192, 1)) {
    const filename = path.join(home, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
    return filename;
  }
  return { root, home, cat, file };
}

test('limpa todos os caches padrão medidos, incluindo downloads atuais do Homebrew, sem executar cleanup/purge', async t => {
  const { cat, home, file } = await fixture(t);
  await file('Library/Caches/Homebrew/downloads/current.tar.gz');
  await file('.npm/_cacache/content-v2/package');
  await file('Library/Caches/pip/http-v2/current');
  await file('.cache/pip/wheels/wheel');
  const packageFile = await file('Library/Python/packages/preservar', 'pacote instalado');
  const customCache = await file('Documents/cache-custom/preservar', 'cache customizado');
  assert.equal(await cat.detect(), true);
  const before = await cat.measure();
  assert.ok(before > 0);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'ok');
  assert.equal(result.freedBytes, before);
  assert.equal(await cat.measure(), 0);
  for (const relative of ['Library/Caches/Homebrew', '.npm', 'Library/Caches/pip', '.cache/pip']) {
    assert.deepEqual(await fs.readdir(path.join(home, relative)), []);
  }
  assert.equal(await fs.readFile(packageFile, 'utf8'), 'pacote instalado');
  assert.equal(await fs.readFile(customCache, 'utf8'), 'cache customizado');
});

test('simulação valida e mede os caches sem apagar arquivos', async t => {
  const { cat, file } = await fixture(t);
  const cached = await file('.npm/_cacache/item');
  const before = await cat.measure();
  const result = await cat.clean({ dryRun: true });
  assert.equal(result.freedBytes, before);
  assert.equal(result.reason, 'simulação');
  assert.equal(await disk.exists(cached), true);
});

test('só inclui caches de ferramentas instaladas e não executa comandos quando nenhuma existe', async t => {
  const { cat, file } = await fixture(t, { installed: ['npm'] });
  await file('.npm/item');
  const brew = await file('Library/Caches/Homebrew/download');
  const pip = await file('Library/Caches/pip/download');
  assert.equal((await cat.clean({ dryRun: false })).status, 'ok');
  assert.equal(await disk.exists(brew), true);
  assert.equal(await disk.exists(pip), true);
  const none = await fixture(t, { installed: [] });
  await none.file('.npm/item');
  assert.equal(await none.cat.detect(), false);
  assert.equal(await none.cat.measure(), 0);
  assert.equal((await none.cat.clean({ dryRun: false })).skipped, true);
});

test('recusa raiz de cache simbólica e não limpa nenhum cache com medição inválida', async t => {
  const { cat, home, file } = await fixture(t);
  const preserve = await file('Documents/preservar');
  await fs.symlink(path.dirname(preserve), path.join(home, '.npm'));
  const brew = await file('Library/Caches/Homebrew/download');
  assert.equal((await cat.settings()).measurementError, true);
  for (const dryRun of [true, false]) {
    const result = await cat.clean({ dryRun });
    assert.equal(result.status, 'failed');
    assert.equal(result.freedBytes, 0);
    assert.match(result.reason, /npm:.*link simbólico/);
  }
  assert.equal(await disk.exists(preserve), true);
  assert.equal(await disk.exists(brew), true);
});

test('remove links dentro do cache sem seguir nem apagar o destino', async t => {
  const { cat, home, file } = await fixture(t);
  const outside = await file('Documents/preservar', 'conteúdo preservado');
  await file('.npm/item');
  await fs.symlink(outside, path.join(home, '.npm/link'));
  assert.equal((await cat.clean({ dryRun: false })).status, 'ok');
  assert.equal(await fs.readFile(outside, 'utf8'), 'conteúdo preservado');
  assert.deepEqual(await fs.readdir(path.join(home, '.npm')), []);
});

test('falha parcial informa motivo, mantém o cache bloqueado e conta somente bytes removidos', async t => {
  const { cat, file } = await fixture(t, { overrides: {
    removeContents: async (dir, prefix) => dir.endsWith('/pip')
      ? { failures: 1, errorCodes: ['EPERM'] } : disk.removeContents(dir, prefix),
  } });
  await file('.npm/item');
  const pip = await file('Library/Caches/pip/item');
  const before = await cat.measure();
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'partial');
  assert.equal(result.skipped, false);
  assert.ok(result.freedBytes > 0 && result.freedBytes < before);
  assert.match(result.reason, /pip3:.*sem permissão/);
  assert.match((await cat.settings()).statusReason, /pip3:/);
  assert.equal(await disk.exists(pip), true);
  assert.equal(await cat.measure(), before - result.freedBytes);
});

test('falha total não aparece como execução bem-sucedida', async t => {
  const { cat, file } = await fixture(t, { overrides: {
    removeContents: async () => ({ failures: 1, errorCodes: ['EBUSY'] }),
  } });
  const cached = await file('.npm/item');
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.skipped, true);
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /em uso/);
  assert.equal(await disk.exists(cached), true);
});

test('erro de permissão na medição mostra erro e impede remoção', async t => {
  let removed = false;
  const { cat, file } = await fixture(t, { overrides: {
    dirSize: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    removeContents: async () => { removed = true; },
  } });
  await file('.npm/item');
  assert.equal((await cat.settings()).measurementError, true);
  assert.match(await cat.accessIssue(), /sem permissão/);
  assert.equal((await cat.clean({ dryRun: false })).status, 'failed');
  assert.equal(removed, false);
});

test('não conta bytes como liberados se a verificação após apagar falhar', async t => {
  let cleaned = false;
  const { cat, file } = await fixture(t, { overrides: {
    dirSize: async (...args) => {
      if (cleaned) throw Object.assign(new Error('não foi possível medir'), { code: 'MEASURE_FAILED' });
      return disk.dirSize(...args);
    },
    removeContents: async (...args) => { const result = await disk.removeContents(...args); cleaned = true; return result; },
  } });
  await file('.npm/item');
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /Não foi possível confirmar/);
});
