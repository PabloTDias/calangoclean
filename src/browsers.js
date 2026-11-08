const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const disk = require('./disk');

// Only fixed browser identifiers and cache locations are accepted. In particular,
// no profile root, Cookies, IndexedDB, History or session file is a delete target.
const DEFINITIONS = [
  { id: 'chrome', name: 'Google Chrome', bundle: 'com.google.Chrome', data: 'Google/Chrome', caches: ['Google/Chrome'] },
  { id: 'chromeBeta', name: 'Google Chrome Beta', bundle: 'com.google.Chrome.beta', data: 'Google/Chrome Beta', caches: ['Google/Chrome Beta'] },
  { id: 'chromeCanary', name: 'Google Chrome Canary', bundle: 'com.google.Chrome.canary', data: 'Google/Chrome Canary', caches: ['Google/Chrome Canary'] },
  { id: 'chromium', name: 'Chromium', bundle: 'org.chromium.Chromium', data: 'Chromium', caches: ['Chromium'] },
  { id: 'edge', name: 'Microsoft Edge', bundle: 'com.microsoft.edgemac', data: 'Microsoft Edge', caches: ['Microsoft Edge'] },
  { id: 'brave', name: 'Brave Browser', bundle: 'com.brave.Browser', data: 'BraveSoftware/Brave-Browser', caches: ['BraveSoftware/Brave-Browser'] },
  { id: 'vivaldi', name: 'Vivaldi', bundle: 'com.vivaldi.Vivaldi', data: 'Vivaldi', caches: ['Vivaldi'] },
  { id: 'opera', name: 'Opera', bundle: 'com.operasoftware.Opera', data: 'com.operasoftware.Opera', directProfile: true, caches: ['com.operasoftware.Opera'] },
  { id: 'operaGX', name: 'Opera GX', bundle: 'com.operasoftware.OperaGX', data: 'com.operasoftware.OperaGX', directProfile: true, caches: ['com.operasoftware.OperaGX'] },
  { id: 'firefox', name: 'Firefox', process: 'firefox', bundle: 'org.mozilla.firefox', caches: ['Firefox', 'org.mozilla.firefox'] },
  { id: 'arc', name: 'Arc', bundle: 'company.thebrowser.Browser', data: 'Arc/User Data', caches: ['Arc', 'company.thebrowser.Browser'] },
  { id: 'safari', name: 'Safari', bundle: 'com.apple.Safari', caches: ['com.apple.Safari'], container: 'com.apple.Safari' },
  { id: 'safariPreview', name: 'Safari Technology Preview', bundle: 'com.apple.SafariTechnologyPreview', caches: ['com.apple.SafariTechnologyPreview'], container: 'com.apple.SafariTechnologyPreview' },
];
const PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'Media Cache', 'Service Worker/CacheStorage'];
const SHARED_CACHES = ['ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'DawnGraphiteCache'];
const PROFILE_NAME = /^(Default|Profile \d+|Guest Profile|System Profile)$/;
const DENIED = 'sem permissão (dê Acesso Total ao Disco ao app)';

function excludedCacheRoots(home = os.homedir()) {
  return DEFINITIONS.flatMap(b => b.caches.map(p => path.join(home, 'Library', 'Caches', p)));
}

function run(cmd, args, { timeout = 10000 } = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function create({ home = os.homedir(), io = fs, storage = disk, execute = run,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const publicBrowser = b => ({ id: b.id, name: b.name });
  const resolveBrowser = id => DEFINITIONS.find(b => b.id === id);

  // ps provides the complete executable path, avoiding truncated process names
  // and ensuring helpers with similar names never count as the main browser.
  async function running(ids) {
    const { err, stdout } = await execute('/bin/ps', ['-axo', 'comm='], { timeout: 5000 });
    if (err) throw new Error('Não foi possível verificar os navegadores abertos.');
    const lines = stdout.split('\n').map(s => s.trim());
    return DEFINITIONS.filter(b => (!ids || ids.includes(b.id)) && lines.some(line =>
      line === (b.process || b.name) ||
      line.endsWith(`/${b.name}.app/Contents/MacOS/${b.process || b.name}`)
    )).map(publicBrowser);
  }

  // Called only by the main process after the user approves closing browsers.
  // The AppleScript cannot be supplied by the renderer. No force quit is used.
  async function quit(ids, { timeoutMs = 10000 } = {}) {
    const wanted = [...new Set(Array.isArray(ids) ? ids : [])].map(resolveBrowser).filter(Boolean);
    const closed = [], failed = [];
    for (const b of wanted) {
      try {
        if (!(await running([b.id])).length) continue;
        const script = `if application id "${b.bundle}" is running then tell application id "${b.bundle}" to quit`;
        const { err, stderr } = await execute('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs });
        const deadline = now() + timeoutMs;
        let remains = (await running([b.id])).length > 0;
        while (!err && remains && now() < deadline) {
          await sleep(200);
          remains = (await running([b.id])).length > 0;
        }
        if (!remains) closed.push(publicBrowser(b));
        else failed.push({ ...publicBrowser(b), reason: /-1743|not authorized|não autorizado/i.test(stderr || '')
          ? 'Sem autorização para fechar o navegador. Autorize o CalangoClean em Ajustes > Privacidade e Segurança > Automação ou feche o navegador manualmente.'
          : err ? 'O navegador recusou ou não concluiu o fechamento. Feche-o e tente de novo.'
            : 'O navegador continua aberto. Salve seu trabalho, feche-o e tente de novo.' });
      } catch (e) { failed.push({ ...publicBrowser(b), reason: e.message }); }
    }
    return { closed, failed };
  }

  async function snapshot() {
    if (!(await storage.hasFullDiskAccess())) return { targets: [], browsers: [], accessIssue: DENIED, measurementError: true };
    const targets = [], browsers = [], problems = [];
    let accessIssue = null;
    const seen = new Set();
    async function target(p, b) {
      if (seen.has(p)) return;
      seen.add(p);
      try {
        const st = await io.lstat(p);
        if (st.isSymbolicLink()) throw new Error('caminho é um link simbólico');
        if (!st.isDirectory()) return;
        await storage.assertSafeTarget(p, p);
        const bytes = await storage.dirSize(p, { strict: true });
        targets.push({ path: p, bytes, browserId: b.id, browserName: b.name });
        if (!browsers.some(x => x.id === b.id)) browsers.push(publicBrowser(b));
      } catch (e) {
        if (e.code === 'ENOENT') return;
        if (e.code === 'EACCES' || e.code === 'EPERM') accessIssue = DENIED;
        problems.push(`${b.name}: ${e.message}`);
      }
    }
    async function profiles(dir, b) {
      let entries;
      try {
        const st = await io.lstat(dir);
        if (st.isSymbolicLink()) throw new Error('pasta de perfis é um link simbólico');
        await storage.assertSafeTarget(dir, dir);
        entries = await io.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') return;
        if (e.code === 'EACCES' || e.code === 'EPERM') accessIssue = DENIED;
        problems.push(`${b.name}: ${e.message}`);
        return;
      }
      if (b.directProfile) for (const suffix of PROFILE_CACHES) await target(path.join(dir, suffix), b);
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink() || !PROFILE_NAME.test(e.name)) continue;
        for (const suffix of PROFILE_CACHES) await target(path.join(dir, e.name, suffix), b);
      }
      for (const suffix of SHARED_CACHES) await target(path.join(dir, suffix), b);
    }
    for (const b of DEFINITIONS) {
      for (const suffix of b.caches) await target(path.join(home, 'Library', 'Caches', suffix), b);
      if (b.container) await target(path.join(home, 'Library', 'Containers', b.container, 'Data', 'Library', 'Caches'), b);
      if (b.data) await profiles(path.join(home, 'Library', 'Application Support', b.data), b);
    }
    return { targets, browsers, accessIssue, measurementError: problems.length > 0, statusReason: problems.length ? 'Não foi possível medir todos os caches' : null, problems };
  }

  return { running, quit, snapshot, excludedCacheRoots: () => excludedCacheRoots(home) };
}

module.exports = { ...create(), create, excludedCacheRoots, cacheRoots: excludedCacheRoots };
