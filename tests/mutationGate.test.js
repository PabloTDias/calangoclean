const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/mutationGate');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('revisão muda somente quando o conteúdo compartilhado é invalidado', async () => {
  const gate = create();
  const initial = gate.revision();
  assert.equal(typeof initial, 'number');
  assert.equal(await gate.run(async () => 'ok', { expectedRevision: initial }), 'ok');
  assert.equal(gate.revision(), initial);
  gate.changed();
  assert.equal(gate.revision(), initial + 1);
});

test('duas mutações simultâneas são recusadas e o lock é liberado ao terminar', async () => {
  const gate = create();
  const started = deferred();
  const resume = deferred();
  let calls = 0;
  const active = gate.run(async () => {
    calls++;
    started.resolve();
    await resume.promise;
  });
  await started.promise;
  try {
    await assert.rejects(async () => gate.run(async () => { calls++; }));
    assert.equal(calls, 1);
  } finally { resume.resolve(); await active; }
  await gate.run(async () => { calls++; });
  assert.equal(calls, 2);
});

test('exceção da operação não deixa a limpeza permanentemente bloqueada', async () => {
  const gate = create();
  await assert.rejects(async () => gate.run(async () => { throw new Error('operation failed'); }), /operation failed/);
  assert.equal(await gate.run(async () => 'next operation'), 'next operation');
});

test('confirmação de revisão diferente é recusada antes de executar o callback', async () => {
  const gate = create();
  const confirmed = gate.revision();
  gate.changed();
  let calls = 0;
  await assert.rejects(async () => gate.run(async () => { calls++; }, { expectedRevision: confirmed }));
  assert.equal(calls, 0);
  await gate.run(async () => { calls++; }, { expectedRevision: gate.revision() });
  assert.equal(calls, 1, 'a stale confirmation must not keep the lock');
});

test('leitura de configuração pendente não reaproveita confirmação anterior às fotos', async () => {
  const gate = create();
  const configRead = deferred();
  const revisionAtRequest = gate.revision();
  let cleaned = false;
  const pending = (async () => {
    await configRead.promise;
    return gate.run(async () => { cleaned = true; }, { expectedRevision: revisionAtRequest });
  })();
  // The photo operation finishes while categories:clean awaits config.loadSafe().
  await gate.run(async () => { gate.changed(); });
  configRead.resolve();
  await assert.rejects(pending);
  assert.equal(cleaned, false);
});

test('IPC antigo entregue após a movimentação de fotos ainda precisa da revisão confirmada', async () => {
  const gate = create();
  const revisionShownInDialog = gate.revision();
  await gate.run(async () => { gate.changed(); });
  let cleaned = false;
  // The renderer has not received photos:changed yet, and submits its old dialog.
  await assert.rejects(async () => gate.run(async () => { cleaned = true; }, { expectedRevision: revisionShownInDialog }));
  assert.equal(cleaned, false);
});

test('fotos podem invalidar a revisão dentro da própria mutação sem perder a exclusão mútua', async () => {
  const gate = create();
  const initial = gate.revision();
  const started = deferred();
  const resume = deferred();
  const active = gate.run(async () => {
    gate.changed();
    started.resolve();
    await resume.promise;
  });
  await started.promise;
  assert.equal(gate.revision(), initial + 1);
  try {
    await assert.rejects(async () => gate.run(async () => assert.fail('must remain locked'), { expectedRevision: gate.revision() }));
  } finally { resume.resolve(); await active; }
  await gate.run(async () => {}, { expectedRevision: gate.revision() });
});
