const fs = require('node:fs/promises');
const path = require('node:path');
const disk = require('../disk');
const { dirCategory, HOME } = require('./dirCategory');

// "https_web.whatsapp.com_0.indexeddb.leveldb" -> "https://web.whatsapp.com"
function originOf(name) {
  const base = name.replace(/\.indexeddb\.(leveldb|blob)$/, '').replace(/_\d+$/, '');
  return base.replace('_', '://');
}

// Maiores sites por tamanho (soma leveldb + blob do mesmo site).
async function topSites(dir, limit = 5) {
  const sizes = new Map();
  for (const name of await fs.readdir(dir)) {
    if (!/\.indexeddb\.(leveldb|blob)$/.test(name)) continue;
    const bytes = (await disk.dirSize(path.join(dir, name))) ?? 0;
    const origin = originOf(name);
    sizes.set(origin, (sizes.get(origin) ?? 0) + bytes);
  }
  return [...sizes]
    .map(([label, bytes]) => ({ label, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

// Só mede e orienta: limpar por fora desloga sites e perde dados locais.
module.exports = dirCategory({
  id: 'chromeIndexedDB',
  label: 'Chrome IndexedDB',
  level: 'manual',
  hint: 'Limpe em chrome://settings/content/all.',
  detail: 'Dados locais de sites. Apagar por fora desloga sites e perde dados: limpe em chrome://settings/content/all, escolhendo os maiores.',
  dir: path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'IndexedDB'),
  mode: 'contents',
  readOnly: true,
  needsFullDisk: true,
  describe: topSites,
});
module.exports.originOf = originOf;
