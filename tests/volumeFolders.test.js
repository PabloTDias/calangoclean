const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../src/volumeFolders');

async function fixture(t, { execute } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'calango-volumes-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mount = path.join(root, 'Disco'); await fs.mkdir(mount);
  let volumes = [{ id: 'disk9s1', path: mount, uuid: 'fixture-volume', used: 16384 }];
  const commands = [];
  const manager = create({ listVolumes: async () => volumes, volumesDir: root, execute: execute || ((command, args, options, callback) => {
    commands.push({ command, args, options });
    const child = { kill() { setImmediate(() => callback(Error('cancelado'), '')); } };
    setImmediate(() => callback(null, `4\t${args[1]}\n`)); return child;
  }) });
  return { root, mount, manager, commands, setVolumes(value) { volumes = value; } };
}

test('discos não são percorridos na criação ou consulta do cache; análise usa só du sem seguir links ou montagens', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.mount, 'Documentos'));
  await fs.mkdir(path.join(f.mount, '.Trashes'));
  await fs.symlink(f.root, path.join(f.mount, 'atalho'));
  assert.equal((await f.manager.last('disk9s1')).result, null); assert.equal(f.commands.length, 0);
  const result = await f.manager.analyze('disk9s1'); assert.equal(result.ok, true);
  assert.deepEqual(f.commands.map(item => [item.command, item.args]), [['/usr/bin/du', ['-skPx', path.join(f.mount, 'Documentos')]]]);
  assert.equal(result.result.items[0].label, 'Documentos'); assert.equal(result.result.items[0].bytes, 4096);
  assert.equal(result.result.items.find(item => item.id === 'undetailed').bytes, 12288);
  assert.deepEqual((await f.manager.last('disk9s1')).result, result.result);
});

test('rejeita IDs arbitrários, discos ausentes, pastas comuns e montagem por symlink', async t => {
  const f = await fixture(t);
  for (const id of ['../Disco', '/Volumes/Disco', {}, undefined]) assert.equal((await f.manager.analyze(id)).ok, false);
  f.setVolumes([]); assert.equal((await f.manager.analyze('disk9s1')).ok, false);
  f.setVolumes([{ id: 'disk9s1', path: f.root }]); assert.equal((await f.manager.analyze('disk9s1')).ok, false);
  const link = path.join(f.root, 'link'); await fs.symlink(f.mount, link);
  f.setVolumes([{ id: 'disk9s1', path: link }]); assert.equal((await f.manager.analyze('disk9s1')).ok, false);
  assert.equal(f.commands.length, 0);
});

test('falha parcial é explícita e mudança da identidade do volume não reutiliza gráfico antigo', async t => {
  const f = await fixture(t, { execute: (_cmd, _args, _options, callback) => { setImmediate(() => callback(Error('sem permissão'), '')); return { kill() {} }; } });
  await fs.mkdir(path.join(f.mount, 'Protegida'));
  const result = await f.manager.analyze('disk9s1'); assert.equal(result.ok, true); assert.equal(result.result.partial, true);
  assert.match(result.result.note, /parcial/); assert.equal(result.result.items[0].bytes, 16384);
  f.setVolumes([{ id: 'disk9s1', path: f.mount, uuid: 'outro-disco', used: 1 }]);
  assert.equal((await f.manager.last('disk9s1')).result, null);
});

test('cancelar interrompe du, não salva resultado e consultas repetidas compartilham a análise', async t => {
  let complete, killed = 0;
  const f = await fixture(t, { execute: (_cmd, _args, _options, callback) => { complete = callback; return { kill() { killed++; setImmediate(() => callback(Error('cancelado'), '')); } }; } });
  await fs.mkdir(path.join(f.mount, 'Grande'));
  const first = f.manager.analyze('disk9s1'); assert.equal(f.manager.analyze('disk9s1'), first);
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  f.manager.cancel('disk9s1'); assert.equal((await first).cancelled, true); assert.equal(killed, 1);
  assert.equal((await f.manager.last('disk9s1')).result, null);
});

test('disco removido ou substituído durante análise descarta os números', async t => {
  let f;
  f = await fixture(t, { execute: (_cmd, args, _options, callback) => { setImmediate(() => { f.setVolumes([]); callback(null, `4\t${args[1]}\n`); }); return { kill() {} }; } });
  await fs.mkdir(path.join(f.mount, 'Dados'));
  const result = await f.manager.analyze('disk9s1'); assert.equal(result.ok, false); assert.match(result.error, /conectado/);
});
