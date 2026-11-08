// Ícones associados aos aplicativos pelo macOS; nunca abre ou executa o aplicativo.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function bundleIcon(bundle) {
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const stat = await fs.lstat(plist);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576 || await fs.realpath(plist) !== plist) return null;
  const { stdout } = await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], { timeout: 3000, maxBuffer: 1024 });
  const name = stdout.trim();
  if (!name || name.length > 255 || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name)) return null;
  const file = path.join(bundle, 'Contents', 'Resources', path.extname(name) ? name : `${name}.icns`);
  const icon = await fs.lstat(file);
  if (!icon.isFile() || icon.isSymbolicLink() || icon.size > 16777216 || await fs.realpath(file) !== file) return null;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'calango-app-icon-'));
  const output = path.join(temp, 'icon.png');
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', file, '--out', output], { timeout: 5000, maxBuffer: 4096 });
    const result = await fs.lstat(output);
    if (!result.isFile() || result.isSymbolicLink() || result.size > 196608) return null;
    const bytes = await fs.readFile(output);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } finally {
    await fs.unlink(output).catch(() => {});
    await fs.rmdir(temp).catch(() => {});
  }
}

function create({ getFileIcon, readBundleIcon = bundleIcon, now = Date.now } = {}) {
  const cache = new Map();
  const lanes = Array.from({ length: 4 }, () => Promise.resolve());
  let lane = 0;
  async function get(bundle) {
    try {
      if (typeof getFileIcon !== 'function' || typeof bundle !== 'string' || !path.isAbsolute(bundle)
        || path.resolve(bundle) !== bundle || !bundle.endsWith('.app') || /[\x00-\x1f\x7f]/.test(bundle)) return null;
      const stat = await fs.lstat(bundle);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(bundle) !== bundle) return null;
      const key = `${bundle}:${stat.dev}:${stat.ino}:${stat.mtimeMs}`;
      const previous = cache.get(key);
      if (previous && now() - previous.at < 300000) return previous.value;
      const index = lane++ % lanes.length;
      const value = lanes[index].then(async () => {
        // A API por tipo de arquivo pode fornecer um ícone genérico para .app.
        // Usa primeiro o ícone declarado pelo bundle; apenas lê e converte a imagem.
        const declared = await readBundleIcon(bundle).catch(() => null);
        if (typeof declared === 'string' && declared.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(declared)) return declared;
        const image = await getFileIcon(bundle, { size: 'normal' });
        if (!image || image.isEmpty()) return null;
        const data = image.toDataURL();
        return typeof data === 'string' && data.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data) ? data : null;
      }).catch(() => null);
      lanes[index] = value;
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), value });
      return value;
    } catch { return null; }
  }
  return { get };
}

module.exports = { create };
