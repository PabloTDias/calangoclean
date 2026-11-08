const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const disk = require('../src/disk');

// Todos os arquivos removidos por estes testes são criados dentro do projeto.
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(__dirname, '.cache-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Caches');
  await fs.mkdir(dir);
  const filename = require.resolve('../src/categories/dirCategory');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, Date, require: id => id === '../disk' ? { ...disk, ...overrides } : localRequire(id),
  }, { filename });
  const create = options => module.exports.dirCategory({
    id: 'caches', label: 'Caches', level: 'seguro', dir, mode: 'contents', ...options,
  });
  const write = async (name, size = 8192) => {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(size, 1));
    return file;
  };
  return { root, dir, create, write };
}

test('caches limpa conteúdo e arquivos ocultos e confirma o tamanho liberado', async t => {
  const { dir, create, write } = await fixture(t);
  await write('app/sub/cache');
  await write('.oculto');
  const cat = create();
  const before = await cat.measure();
  assert.ok(before > 0);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'ok');
  assert.equal(result.skipped, false);
  assert.equal(result.freedBytes, before);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.equal(await cat.measure(), 0);
});

test('simulação mede sem apagar os caches', async t => {
  const { create, write } = await fixture(t);
  const file = await write('app/cache');
  const cat = create();
  const result = await cat.clean({ dryRun: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.reason, 'simulação');
  assert.equal(result.freedBytes, await cat.measure());
  assert.equal(await disk.exists(file), true);
});

test('falha de permissão em um app permite limpar os demais e informa parcial', async t => {
  const { create, write } = await fixture(t, {
    dirSize: async (target, options) => {
      if (path.basename(target) === 'protegido') throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return disk.dirSize(target, options);
    },
  });
  const accessible = await write('acessivel');
  const protectedFile = await write('protegido');
  const cat = create();
  assert.equal(await cat.measure(), await disk.dirSize(accessible));
  const settings = await cat.settings();
  assert.equal(settings.measurementError, false);
  assert.equal(settings.measurementPartial, true);
  assert.match(settings.statusReason, /Algumas pastas/);
  assert.match(settings.statusDetails, /protegido: Sem permissão para ler/);
  assert.equal(await cat.accessIssue(), null);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'partial');
  assert.ok(result.freedBytes > 0);
  assert.equal(await disk.exists(accessible), false);
  assert.equal(await disk.exists(protectedFile), true);
  assert.match((await cat.settings()).statusDetails, /protegido: Sem permissão/);
});

test('medição totalmente negada não aparece como 0 B conhecido e não apaga', async t => {
  let removals = 0;
  const { create, write } = await fixture(t, {
    dirSize: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    removePaths: async () => { removals++; return { failures: 0 }; },
  });
  await write('protegido');
  const cat = create();
  assert.equal((await cat.settings()).measurementError, true);
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.freedBytes, 0);
  assert.equal(removals, 0);
});

test('falha total ao apagar preserva motivo real e não é sucesso', async t => {
  const { create, write } = await fixture(t, {
    removePaths: async paths => ({ failures: paths.length,
      errors: paths.map(target => ({ path: target, code: 'EPERM' })) }),
  });
  const file = await write('bloqueado');
  const cat = create();
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.skipped, true);
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /bloqueado: Sem permissão para apagar/);
  assert.doesNotMatch(result.reason, /em uso/);
  assert.equal(await disk.exists(file), true);
  assert.match((await cat.settings()).statusDetails, /Sem permissão para apagar/);
});

test('ENOTEMPTY chega ao painel como resumo amigável e mantém diagnóstico separado',async t=>{
  const {create,write}=await fixture(t,{removePaths:async paths=>({failures:paths.length,errors:paths.map(target=>({path:target,code:'ENOTEMPTY'}))})});
  await write('com.microsoft.VSCode.ShipIt/item');const cat=create();
  const result=await cat.clean({dryRun:false});const settings=await cat.settings();
  assert.equal(settings.statusReason,'Alguns arquivos foram mantidos');
  assert.doesNotMatch(settings.statusReason,/ENOTEMPTY|ShipIt/);
  assert.match(settings.statusDetails,/ENOTEMPTY/);assert.equal(settings.remainingCount,1);
  assert.equal(result.userMessage,'Alguns arquivos foram mantidos');assert.equal(result.status,'failed');
});

test('falha parcial contabiliza somente bytes removidos, mesmo se outros caches surgirem', async t => {
  let added;
  const { create, write, dir } = await fixture(t, {
    removePaths: async paths => {
      await fs.rm(paths[0], { recursive: true });
      added = path.join(dir, 'novo-cache');
      await fs.writeFile(added, Buffer.alloc(32768, 1));
      return { failures: 1, errors: [{ path: paths[1], code: 'EBUSY' }] };
    },
  });
  const first = await write('a');
  await write('b');
  const expected = await disk.dirSize(first);
  const result = await create().clean({ dryRun: false });
  assert.equal(result.status, 'partial');
  assert.equal(result.skipped, false);
  assert.equal(result.freedBytes, expected);
  assert.match(result.reason, /b: Item em uso/);
  assert.equal(await disk.exists(added), true);
});

test('falha ao confirmar a limpeza não inventa bytes liberados', async t => {
  let cleaning = false;
  const { create, write } = await fixture(t, {
    removePaths: async () => { cleaning = true; return { failures: 0 }; },
    dirSize: async (target, options) => {
      if (cleaning) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return disk.dirSize(target, options);
    },
  });
  await write('app');
  const result = await create().clean({ dryRun: false });
  assert.equal(result.status, 'failed');
  assert.equal(result.freedBytes, 0);
  assert.match(result.reason, /confirmar a limpeza/);
});

test('exclui browsers e dev sem excluir outros apps no mesmo ancestral', async t => {
  const { create, write, dir } = await fixture(t);
  const browser = await write('Google/Chrome/cache');
  const other = await write('Google/Outro/cache');
  const dev = await write('pip/cache');
  const cat = create({ excludePaths: [path.join(dir, 'Google', 'Chrome'), path.join(dir, 'pip')] });
  assert.equal(await cat.measure(), await disk.dirSize(path.dirname(other)));
  const result = await cat.clean({ dryRun: false });
  assert.equal(result.status, 'ok');
  assert.equal(await disk.exists(browser), true);
  assert.equal(await disk.exists(dev), true);
  assert.equal(await disk.exists(other), false);
});

test('remove links de cache sem seguir o destino e recusa raiz com link', async t => {
  const { create, write, dir, root } = await fixture(t);
  const outside = path.join(root, 'preservado');
  await fs.writeFile(outside, Buffer.alloc(8192, 1));
  await write('app');
  await fs.symlink(outside, path.join(dir, 'link'));
  assert.equal((await create().clean({ dryRun: false })).status, 'ok');
  assert.equal(await disk.exists(outside), true);
  await write('app');
  const rootLink = path.join(root, 'linkCaches');
  await fs.symlink(dir, rootLink);
  const result = await create({ dir: rootLink }).clean({ dryRun: true });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /caminho recusado/);
  assert.equal(await disk.exists(path.join(dir, 'app')), true);
});

test('categorias protegidas sem Acesso Total não tentam ler pastas de outros apps', async t => {
  let touched = 0;
  const { create } = await fixture(t, {
    hasFullDiskAccess: async () => false,
    access: async () => { touched++; return 'ok'; },
    dirSize: async () => { touched++; return 100; },
  });
  const cat = create({ needsFullDisk: true });
  assert.equal(await cat.detect(), true);
  assert.equal(await cat.measure(), 0);
  assert.match(await cat.accessIssue(), /Acesso Total/);
  assert.equal((await cat.clean({ dryRun: false })).status, 'failed');
  assert.equal(touched, 0);
});
