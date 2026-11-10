const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, newer, parseRelease, downloadUrl, INTERVAL } = require('../src/updates');

const release = (version = 'v0.3.2') => ({
  tag_name: version, draft: false, prerelease: false,
  assets: [{ name: 'CalangoClean.dmg', state: 'uploaded', size: 100, digest: `sha256:${'ab'.repeat(32)}`,
    browser_download_url: `https://github.com/PabloTDias/calangoclean/releases/download/${version}/CalangoClean.dmg` }],
});

test('compara versões numericamente e ignora versões iguais, antigas ou inválidas', () => {
  assert.equal(newer('v0.3.10', '0.3.9'), true);
  for (const v of ['v0.3.1', 'v0.3.0', 'v0.3.2-beta', 'invalid', '1.2']) {
    assert.equal(newer(v, '0.3.1'), false);
  }
});

test('só oferece release estável com DMG válido do repositório esperado', () => {
  assert.equal(parseRelease(release(), '0.3.1').version, '0.3.2');
  assert.equal(parseRelease(release(), '0.3.2'), null);
  assert.equal(parseRelease({ ...release(), draft: true }, '0.3.1'), null);
  assert.equal(parseRelease({ ...release(), prerelease: true }, '0.3.1'), null);
  assert.equal(parseRelease({ ...release(), assets: [] }, '0.3.1'), null);
  assert.equal(parseRelease(release(), '0.3.1').sha256, 'ab'.repeat(32));
  const noDigest = release(); delete noDigest.assets[0].digest;
  assert.equal(parseRelease(noDigest, '0.3.1'), null, 'sem SHA-256 publicado não há atualização segura');
  const badDigest = release(); badDigest.assets[0].digest = 'sha1:abc';
  assert.equal(parseRelease(badDigest, '0.3.1'), null);
  const versioned = release();
  versioned.assets[0].name = 'CalangoClean-0.3.2-universal.dmg';
  assert.ok(parseRelease(versioned, '0.3.1'));
  for (const url of [undefined, 'https://evil.example/update.dmg',
    'https://github.com/other/repo/releases/download/v1/CalangoClean.dmg',
    'http://github.com/PabloTDias/calangoclean/releases/download/v1/CalangoClean.dmg',
    'https://user:pass@github.com/PabloTDias/calangoclean/releases/download/v1/CalangoClean.dmg']) {
    assert.equal(downloadUrl(url), null);
  }
});

test('limita consultas automáticas e permite verificação manual', async () => {
  let calls = 0, now = 1000;
  const checker = create({ version: '0.3.1', now: () => now,
    fetch: async () => { calls++; return release(); } });
  assert.equal((await checker.check()).available.version, '0.3.2');
  await checker.check();
  assert.equal(calls, 1);
  await checker.check({ force: true });
  assert.equal(calls, 2);
  now += INTERVAL;
  await checker.check();
  assert.equal(calls, 3);
});

test('release mais nova sem instalador informa publicação incompleta e recupera após upload', async () => {
  let uploaded = false;
  const checker = create({ version: '0.3.2', fetch: async () => ({
    ...release('v0.3.3'), ...(uploaded ? {} : { assets: [] }),
  }) });
  const missing = await checker.check();
  assert.equal(missing.available, null);
  assert.match(missing.error, /0\.3\.3.*instalador/);
  uploaded = true;
  const ready = await checker.check({ force: true });
  assert.equal(ready.error, null);
  assert.equal(ready.available.version, '0.3.3');
});

test('consultas simultâneas compartilham a mesma requisição', async () => {
  let resolve, calls = 0;
  const checker = create({ version: '0.3.1', fetch: () => {
    calls++;
    return new Promise((r) => { resolve = r; });
  } });
  const a = checker.check(), b = checker.check({ force: true });
  resolve(release());
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
});

test('falha de rede mantém aviso já recebido e permite tentar novamente', async () => {
  let fail = false;
  const checker = create({ version: '0.3.1', fetch: async () => {
    if (fail) throw new Error('offline');
    return release();
  } });
  await checker.check();
  fail = true;
  const state = await checker.check({ force: true });
  assert.ok(state.error);
  assert.equal(state.available.version, '0.3.2');
  fail = false;
  assert.equal((await checker.check({ force: true })).error, null);
});
