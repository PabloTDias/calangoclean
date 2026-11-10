// Aviso de atualização via GitHub Releases. Só consulta metadados; não instala nem executa arquivos.
const https = require('node:https');

const REPO = 'PabloTDias/calangoclean';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const INTERVAL = 6 * 60 * 60 * 1000;

function versionParts(value) {
  const m = String(value).match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function newer(next, current) {
  const a = versionParts(next), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function downloadUrl(value) {
  try {
    const u = new URL(value);
    return u.origin === 'https://github.com' && !u.username && !u.password &&
      u.pathname.startsWith(`/${REPO}/releases/download/`) && u.pathname.endsWith('.dmg') &&
      !u.search && !u.hash ? u.href : null;
  } catch { return null; }
}

function parseRelease(release, current) {
  if (!release || release.draft || release.prerelease || !newer(release.tag_name, current)) return null;
  const asset = (Array.isArray(release.assets) ? release.assets : []).find((a) =>
    a.state === 'uploaded' && a.size > 0 && /^CalangoClean(?:-\d+\.\d+\.\d+-universal)?\.dmg$/.test(a.name) &&
    downloadUrl(a.browser_download_url));
  if (!asset) return null;
  // O GitHub publica o SHA-256 do asset em `digest` ("sha256:<64 hex>"). Sem ele não há como conferir o arquivo.
  const m = typeof asset.digest === 'string' ? asset.digest.match(/^sha256:([0-9a-f]{64})$/i) : null;
  if (!m) return null;
  return { version: release.tag_name.replace(/^v/, ''), url: downloadUrl(asset.browser_download_url),
    sha256: m[1].toLowerCase(), size: asset.size, name: asset.name };
}

function fetchRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CalangoClean' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Não foi possível consultar as atualizações no GitHub. Tente novamente mais tarde.'));
      }
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
        if (text.length > 1024 * 1024) req.destroy(new Error('Resposta de atualização muito grande.'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Resposta de atualização inválida.')); }
      });
    });
    // Prazo total: também interrompe DNS/conexões que não chegam a responder.
    const timer = setTimeout(() => req.destroy(new Error('A consulta de atualização demorou demais.')), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}

// Dependências injetáveis para testar sem rede nem Electron.
function create({ version, fetch = fetchRelease, now = Date.now } = {}) {
  let state = { current: version, available: null, error: null, checkedAt: null };
  let checked = false;
  let at = 0;
  let running = null;
  function check({ force = false } = {}) {
    if (running) return running;
    if (!force && checked && now() - at < INTERVAL) return Promise.resolve(state);
    running = (async () => {
      try {
        const release = await fetch();
        const available = parseRelease(release, version);
        const incomplete = release && !release.draft && !release.prerelease && newer(release.tag_name, version) && !available;
        state = { ...state, available,
          error: incomplete ? `A versão ${release.tag_name.replace(/^v/, '')} foi publicada, mas o instalador ainda não está disponível. Tente novamente mais tarde.` : null,
          checkedAt: new Date(now()).toISOString() };
      } catch {
        state = { ...state, error: 'Não foi possível verificar atualizações. Confira a conexão e tente novamente.' };
      }
      checked = true;
      at = now();
      return state;
    })().finally(() => { running = null; });
    return running;
  }
  return { check, getState: () => state };
}

module.exports = { create, newer, parseRelease, downloadUrl, INTERVAL };
