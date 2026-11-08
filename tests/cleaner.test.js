const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/cleaner');

function fixture() {
  const calls = [];
  const categories = new Map([
    ['caches', { id: 'caches', level: 'seguro', clean: async () => { calls.push('apps'); return { freedBytes: 100, skipped: false }; } }],
    ['browser', {
      id: 'browser', level: 'seguro', requiresBrowserQuit: true,
      runningBrowsers: async () => { calls.push('running'); return [{ id: 'firefox', name: 'Firefox' }]; },
      clean: async ({ dryRun }) => { calls.push(dryRun ? 'simulate' : 'browser'); return { freedBytes: 200, skipped: false }; },
    }],
    ['whatsapp', { id: 'whatsapp', level: 'manual', clean: () => assert.fail('manual não pode limpar') }],
  ]);
  const browsers = { quit: async (ids) => { calls.push(['quit', ...ids]); return { closed: [{ id: 'firefox' }], failed: [] }; } };
  const cleaner = create({ categories: { get: (id) => categories.get(id), isCleanable: (cat) => ['seguro', 'atencao'].includes(cat.level) }, browsers });
  return { ...cleaner, categories, browsers, calls };
}

test('limpeza real fecha navegadores apenas após consentimento e antes de apagar cache', async () => {
  const f = fixture();
  const history = [];
  const out = await f.clean(['caches', 'browser', 'whatsapp', 'browser', 'unknown'], {
    dryRun: false, closeBrowsers: true, onResult: async (id, result) => history.push({ id, ...result }),
  });
  assert.deepEqual(f.calls, ['apps', 'running', ['quit', 'firefox'], 'browser']);
  assert.equal(out.results.length, 2);
  assert.equal(history.length, 2);
});

test('sem consentimento nenhum comando de saída nem remoção do cache de browser é executado', async () => {
  const f = fixture();
  const out = await f.clean(['browser'], { dryRun: false });
  assert.deepEqual(f.calls, ['running']);
  assert.equal(out.results[0].status, 'failed');
  assert.equal(out.results[0].freedBytes, 0);
  assert.match(out.results[0].reason, /Confirme o aviso/);
});

test('simulação mede navegadores abertos sem fechá-los', async () => {
  const f = fixture();
  const out = await f.clean(['browser'], { dryRun: true, closeBrowsers: true });
  assert.deepEqual(f.calls, ['simulate']);
  assert.equal(out.results[0].freedBytes, 200);
});

test('falha de fechamento é relatada com motivo e sem esconder liberação parcial', async () => {
  const f = fixture();
  f.browsers.quit = async () => ({ closed: [], failed: [{ id: 'firefox', name: 'Firefox', reason: 'Automação recusada' }] });
  const out = await f.clean(['browser'], { dryRun: false, closeBrowsers: true });
  assert.equal(out.results[0].status, 'partial');
  assert.match(out.results[0].reason, /Firefox: Automação recusada/);
});

test('exceção de uma categoria não interrompe as demais nem deixa a limpeza travada', async () => {
  const f = fixture();
  f.categories.get('caches').clean = async () => { throw new Error('Sem permissão'); };
  const out = await f.clean(['caches', 'browser'], { dryRun: true });
  assert.equal(out.results[0].status, 'failed');
  assert.equal(out.results[1].freedBytes, 200);
  assert.equal((await f.clean([], { dryRun: true })).results.length, 0);
});

test('segunda limpeza simultânea é recusada', async () => {
  const f = fixture();
  let resume;
  f.categories.get('caches').clean = () => new Promise((resolve) => { resume = resolve; });
  const active = f.clean(['caches'], { dryRun: true });
  await assert.rejects(f.clean(['browser'], { dryRun: false, closeBrowsers: true }), /em andamento/);
  resume({ freedBytes: 0, skipped: false });
  await active;
});

test('opção sem fechar navegadores limpa as demais categorias e não consulta nem fecha browsers', async () => {
  const f = fixture();
  const out = await f.clean(['caches','browser'], { dryRun:false,skipBrowsers:true,closeBrowsers:true });
  assert.deepEqual(f.calls,['apps']);
  assert.deepEqual(out.results.map(row=>row.id),['caches']);
  assert.equal(out.results[0].freedBytes,100);
});

test('sem navegadores continua respeitando o modo simulação e categorias manuais', async () => {
  const f = fixture();
  const out = await f.clean(['browser','whatsapp','caches'], { dryRun:true,skipBrowsers:true });
  assert.deepEqual(f.calls,['apps']);
  assert.equal(out.dryRun,true);
  assert.equal(out.results.length,1);
});
