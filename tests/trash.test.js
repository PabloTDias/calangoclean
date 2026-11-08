const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const disk = require('../src/disk');

const DAY = 86400000;

// Cada teste apaga apenas arquivos criados por ele, dentro do projeto.
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(__dirname, '.trash-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Trash');
  await fs.mkdir(dir);
  const filename = require.resolve('../src/categories/trashOld');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, require: (id) => id === '../disk' ? { ...disk, ...overrides } : localRequire(id),
  }, { filename });
  const file = path.join(dir, 'item');
  await fs.writeFile(file, Buffer.alloc(8192, 1));
  return { dir, file, root, create: module.exports.create };
}

test('Tudo inclui itens recentes, mesmo com ctime igual ou posterior ao relógio, e invalida a análise ao limpar', async (t) => {
  const { dir, file, create } = await fixture(t);
  const now = (await fs.lstat(file)).ctimeMs - DAY;
  const cat = create({ dir, getDays: async () => 0, now: () => now });
  assert.equal(cat.label, 'Lixeira');
  const before = await cat.measure();
  assert.ok(before > 0);
  assert.equal((await cat.settings()).eligibleCount, 1);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.freedBytes, before);
  assert.equal(result.skipped, false);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.equal(await cat.measure(), 0);
  assert.equal(await cat.note(), null);
  assert.equal((await cat.settings()).eligibleCount, 0);
});

test('prazo usa ctime, preserva arquivos recentes com mtime antigo e respeita a simulação', async (t) => {
  const { dir, file, create } = await fixture(t);
  const ancient = new Date('2000-01-01');
  await fs.utimes(file, ancient, ancient);
  const ctime = (await fs.lstat(file)).ctimeMs;
  const cat = create({ dir, getDays: async () => 7, now: () => ctime + DAY });
  assert.equal(await cat.measure(), 0);
  assert.equal((await cat.clean({ dryRun: false })).skipped, true);
  assert.equal(await disk.exists(file), true);
  const old = create({ dir, getDays: async () => 7, now: () => ctime + 8 * DAY });
  assert.ok(await old.measure() > 0);
  const simulation = await old.clean({ dryRun: true });
  assert.equal(simulation.reason, 'simulação');
  assert.ok(simulation.freedBytes > 0);
  assert.equal(await disk.exists(file), true);
});

test('remove arquivo vazio e link da Lixeira sem seguir seu destino', async (t) => {
  const { dir, file, root, create } = await fixture(t);
  await fs.writeFile(file, '');
  const outside = path.join(root, 'preservar');
  await fs.writeFile(outside, 'preservado');
  await fs.symlink(outside, path.join(dir, 'link'));
  const cat = create({ dir, getDays: async () => 0 });
  assert.equal((await cat.settings()).eligibleCount, 2);
  assert.equal((await cat.clean({ dryRun: false })).skipped, false);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.equal(await fs.readFile(outside, 'utf8'), 'preservado');
});

test('falha total de permissão não aparece como sucesso nem como espaço liberado', async (t) => {
  const { dir, file, create } = await fixture(t, {
    removePaths: async () => ({ failures: 1, errorCodes: ['EPERM'] }),
  });
  const cat = create({ dir, getDays: async () => 0 });
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.skipped, true);
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /item: Sem permissão para apagar/);
  assert.equal(result.status, 'failed');
  assert.match(await cat.note(), /Sem permissão/);
  assert.equal(await disk.exists(file), true);
});

test('falha parcial mantém o motivo e contabiliza somente o que foi apagado', async (t) => {
  const { dir, file, create } = await fixture(t, {
    removePaths: async (entries) => {
      await fs.rm(entries[0]);
      return { failures: 1, errorCodes: ['EBUSY'] };
    },
  });
  await fs.writeFile(path.join(dir, 'outro'), Buffer.alloc(8192, 1));
  const cat = create({ dir, getDays: async () => 0 });
  const before = await cat.measure();
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.skipped, false);
  assert.ok(result.freedBytes > 0 && result.freedBytes < before);
  assert.match(result.reason, /em uso/);
  assert.equal((await fs.readdir(dir)).length, 1);
  assert.equal(await cat.measure(), before - result.freedBytes);
});

test('recusa raiz com link simbólico também em simulação', async (t) => {
  const { dir, root, file, create } = await fixture(t);
  const link = path.join(root, 'TrashLink');
  await fs.symlink(dir, link);
  const cat = create({ dir: link, getDays: async () => 0 });
  for (const dryRun of [true, false]) {
    const result = await cat.clean({ dryRun });
    assert.equal(result.skipped, true);
    assert.match(result.reason, /caminho recusado/);
  }
  assert.equal(await disk.exists(file), true);
});

test('removePaths preserva códigos de erro e ignora arquivos que já sumiram', async (t) => {
  const { dir, root } = await fixture(t);
  const missing = path.join(dir, 'sumiu');
  assert.equal((await disk.removePaths([missing], dir)).failures, 0);
  const outside = path.join(root, 'fora-do-prefixo');
  await fs.writeFile(outside, 'preservado');
  const result = await disk.removePaths([outside], dir);
  assert.equal(result.failures, 1);
  assert.ok(result.errorCodes.includes('UNSAFE_TARGET'));
  assert.equal(await fs.readFile(outside, 'utf8'), 'preservado');
});

test('Tudo usa o esvaziamento nativo e mede todos os itens listados pelo Finder', async (t) => {
  const { dir, file, root, create } = await fixture(t);
  const second = path.join(root, 'outro-volume');
  await fs.writeFile(second, Buffer.alloc(8192, 1));
  let paths = [file, second], calls = 0;
  const finder = {
    list: async () => paths,
    empty: async () => {
      calls++;
      for (const p of paths) await fs.rm(p);
      paths = [];
    },
  };
  const cat = create({ dir, getDays: async () => 0, finder });
  const bytes = await cat.measure();
  assert.equal(bytes, await disk.dirSize(file) + await disk.dirSize(second));
  const simulation = await cat.clean({ dryRun: true });
  assert.equal(simulation.freedBytes, bytes);
  assert.equal(calls, 0);
  assert.equal(await disk.exists(file), true);
  const result = await cat.clean({ dryRun: false });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.remainingCount, 0);
  assert.equal(result.freedBytes, bytes);
});

test('Finder deixa um item bloqueado: mostra nome, motivo e status parcial após analisar de novo', async (t) => {
  const { dir, file, create } = await fixture(t);
  const blocked = path.join(dir, 'bloqueado');
  await fs.writeFile(blocked, Buffer.alloc(8192, 1));
  const finder = {
    list: async () => (await fs.readdir(dir)).map(n => path.join(dir, n)),
    empty: async () => {
      await fs.rm(file);
      throw Object.assign(new Error('Item bloqueado'), { code: -45 });
    },
  };
  const cat = create({ dir, getDays: async () => 0, finder });
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'partial');
  assert.equal(result.skipped, false);
  assert.equal(result.remainingCount, 1);
  assert.match(result.reason, /bloqueado:.*Item bloqueado pelo macOS/);
  assert.ok(result.freedBytes > 0);
  assert.match((await cat.settings()).statusReason, /bloqueado pelo macOS/);
  assert.equal(await cat.accessIssue(), null);
  assert.equal(await disk.exists(blocked), true);
});

test('autorização do Finder negada é status de permissão, sem tentar esvaziar', async (t) => {
  const { dir, file, create } = await fixture(t);
  let calls = 0;
  const finder = {
    list: async () => { throw Object.assign(new Error('Not authorized'), { code: -1743 }); },
    empty: async () => { calls++; },
  };
  const cat = create({ dir, getDays: async () => 0, finder });
  assert.match(await cat.accessIssue(), /Sem autorização.*Finder/);
  assert.equal((await cat.settings()).permissionKind, 'automation');
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
  assert.equal(await disk.exists(file), true);
});

test('sem Acesso Total ao Disco mostra permissão e não aciona o Finder', async (t) => {
  const { dir, create } = await fixture(t, { access: async () => 'denied' });
  let calls = 0;
  const cat = create({ dir, getDays: async () => 0, finder: {
    list: async () => { calls++; return []; }, empty: async () => { calls++; },
  } });
  assert.match(await cat.accessIssue(), /Acesso Total ao Disco/);
  assert.equal((await cat.settings()).permissionKind, 'fullDisk');
  assert.equal((await cat.clean({ dryRun: false })).skipped, true);
  assert.equal(calls, 0);
});

test('medição negada não vira 0 B conhecido nem autoriza apagar', async (t) => {
  const { dir, file, create } = await fixture(t, {
    dirSize: async () => { throw Object.assign(new Error('permission'), { code: 'EACCES' }); },
  });
  const cat = create({ dir, getDays: async () => 0 });
  const settings = await cat.settings();
  assert.equal(settings.measurementError, true);
  assert.match(settings.statusReason, /item: Sem permissão para ler/);
  assert.equal((await cat.clean({ dryRun: false })).status, 'failed');
  assert.equal(await disk.exists(file), true);
});

test('não informa sucesso nem bytes liberados se a verificação do Finder falha', async (t) => {
  const { dir, file, create } = await fixture(t);
  let emptied = false;
  const cat = create({ dir, getDays: async () => 0, finder: {
    list: async () => {
      if (emptied) throw Object.assign(new Error('timeout'), { code: -1712 });
      return [file];
    },
    empty: async () => { emptied = true; },
  } });
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /Não foi possível confirmar/);
});
