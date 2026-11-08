const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('migração para produção preserva preferências, é única e recusa JSON inválido', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'calangoclean-config-'));
  try {
    const module = { exports: {} };
    vm.runInNewContext(await fs.readFile(require.resolve('../src/config'), 'utf8'), {
      module, process,
      require: (id) => id === 'node:os' ? { homedir: () => home } : require(id),
    });
    const config = module.exports;
    await config.enableProduction();
    assert.equal((await config.load()).dryRun, false);
    const old = { dryRun: true, categories: { logs: false }, schedule: { enabled: false }, custom: 42 };
    await fs.writeFile(config.CONFIG_FILE, JSON.stringify(old));
    await config.enableProduction();
    assert.deepEqual(JSON.parse(await fs.readFile(config.CONFIG_FILE, 'utf8')), {
      ...old, dryRun: false, productionModeVersion: 1,
    });
    await config.update((cfg) => { cfg.dryRun = true; });
    const before = await fs.readFile(config.CONFIG_FILE, 'utf8');
    await config.enableProduction();
    assert.equal(await fs.readFile(config.CONFIG_FILE, 'utf8'), before);
    await fs.writeFile(config.CONFIG_FILE, '{invalid');
    await assert.rejects(config.enableProduction());
    assert.equal(await fs.readFile(config.CONFIG_FILE, 'utf8'), '{invalid');
    assert.equal((await config.loadSafe()).cfg.dryRun, true);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('aparência persiste sem injetar padrões e config inválido continua intocado', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'calangoclean-appearance-config-'));
  try {
    const module = { exports: {} };
    vm.runInNewContext(await fs.readFile(require.resolve('../src/config'), 'utf8'), {
      module, process,
      require: (id) => id === 'node:os' ? { homedir: () => home } : require(id),
    });
    const config = module.exports;
    assert.equal((await config.load()).appearance, 'automatico');
    await fs.mkdir(config.APP_DIR, { recursive: true });
    const original = { dryRun: true, categories: { caches: false }, schedule: { enabled: true }, custom: 'preservado' };
    await fs.writeFile(config.CONFIG_FILE, JSON.stringify(original));
    await config.update((cfg) => { cfg.appearance = 'noturno'; });
    assert.deepEqual(JSON.parse(await fs.readFile(config.CONFIG_FILE, 'utf8')), { ...original, appearance: 'noturno' });
    await config.update(cfg=>{cfg.soundEnabled=false;});
    assert.deepEqual(JSON.parse(await fs.readFile(config.CONFIG_FILE, 'utf8')), { ...original, appearance: 'noturno',soundEnabled:false });
    await fs.writeFile(config.CONFIG_FILE, JSON.stringify({ ...original, appearance: 'valor-antigo' }));
    assert.equal((await config.load()).appearance, 'automatico');
    await fs.writeFile(config.CONFIG_FILE, '{invalid');
    await assert.rejects(config.update((cfg) => { cfg.appearance = 'normal'; }));
    assert.equal(await fs.readFile(config.CONFIG_FILE, 'utf8'), '{invalid');
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
