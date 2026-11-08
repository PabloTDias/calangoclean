const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { create } = require('../src/appIcons');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'calango-icons-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'Example.app'); await fs.mkdir(bundle);
  return { root, bundle };
}

test('ícones nativos são consultados uma vez por bundle e retornam somente PNG em dados', async t => {
  const { bundle } = await fixture(t); const calls = [];
  const icons = create({ getFileIcon: async (...args) => { calls.push(args); return { isEmpty: () => false, toDataURL: () => png }; } });
  assert.deepEqual(await Promise.all([icons.get(bundle), icons.get(bundle)]), [png, png]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [bundle, { size: 'normal' }]);
});

test('caminhos inválidos e links não chegam à API de ícones do sistema', async t => {
  const { bundle, root } = await fixture(t); let calls = 0;
  const icons = create({ getFileIcon: async () => { calls++; throw Error('não deveria consultar'); } });
  const link = path.join(root, 'Link.app'); await fs.symlink(bundle, link);
  for (const input of [link, root, '../Example.app', `${bundle}/../Example.app`, null]) assert.equal(await icons.get(input), null);
  assert.equal(calls, 0);
});

test('prefere o ícone declarado pelo aplicativo ao ícone genérico por tipo', async t => {
  const { bundle } = await fixture(t); let nativeCalls = 0;
  const icons = create({ readBundleIcon: async file => { assert.equal(file, bundle); return png; },
    getFileIcon: async () => { nativeCalls++; throw Error('não deveria usar ícone genérico'); } });
  assert.equal(await icons.get(bundle), png);
  assert.equal(nativeCalls, 0);
});

test('falhas, imagens vazias e URLs externas usam fallback sem bloquear listagem', async t => {
  const { bundle } = await fixture(t);
  for (const getFileIcon of [async () => { throw Error('sem ícone'); }, async () => ({ isEmpty: () => true }), async () => ({ isEmpty: () => false, toDataURL: () => 'https://example.com/icon.png' })]) {
    assert.equal(await create({ getFileIcon }).get(bundle), null);
  }
});
