// Divisão do espaço usado por pastas da home (gráfico do card do disco).
// SOMENTE LEITURA: usa `du -sk` e nada mais; nunca apaga, move ou altera arquivos.
// Só roda por clique do usuário (IPC 'folders:analyze'); o último resultado fica em folders.json
// (arquivo próprio, para não mexer no config.json). Não é importado pelo cli.js nem pelo scheduler.js.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { APP_DIR } = require('./config');
const disk = require('./disk');

const HOME = os.homedir();
const RESULT_FILE = path.join(APP_DIR, 'folders.json');

// Caminhos fixos. O painel só manda o id; o caminho nunca vem dele.
const FOLDERS = [
  { id: 'apps', label: 'Aplicativos', paths: ['/Applications', path.join(HOME, 'Applications')] },
  { id: 'documents', label: 'Documentos', paths: [path.join(HOME, 'Documents')] },
  { id: 'downloads', label: 'Downloads', paths: [path.join(HOME, 'Downloads')] },
  { id: 'movies', label: 'Filmes', paths: [path.join(HOME, 'Movies')] },
  { id: 'pictures', label: 'Imagens', paths: [path.join(HOME, 'Pictures')] },
  { id: 'library', label: 'Biblioteca', paths: [path.join(HOME, 'Library')] },
];

let children = new Set();
let running = null; // Promise da análise em andamento (um clique repetido reaproveita)
let cancelled = false;

function du(p) {
  return new Promise((resolve) => {
    // `du` sai com erro em pastas sem permissão, mas imprime o total parcial. Não segue symlinks (-P).
    const child = execFile('/usr/bin/du', ['-skP', p], { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      children.delete(child);
      const kb = parseInt(String(stdout || '').split('\t')[0], 10);
      resolve(Number.isFinite(kb) ? kb * 1024 : 0);
    });
    children.add(child);
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Pastas de outros apps dentro da Biblioteca: sem Acesso Total ao Disco o app não toca nelas (o macOS avisaria
// que ele "tentou acessar dados de outros apps"), então a Biblioteca é medida sem elas e marcada como parcial.
const OTHER_APPS = new Set(['Containers', 'Group Containers']);

async function measureLibrary(lib, fda) {
  if (fda) return { bytes: await du(lib), partial: false };
  let names = [];
  try { names = await fs.readdir(lib); } catch { return { bytes: 0, partial: true }; }
  const sizes = await Promise.all(names.filter((n) => !OTHER_APPS.has(n)).map((n) => du(path.join(lib, n))));
  return { bytes: sizes.reduce((a, b) => a + b, 0), partial: true };
}

async function measure(f, fda) {
  if (f.id === 'library') {
    const parts = await Promise.all(f.paths.map(async (p) => ((await exists(p)) ? measureLibrary(p, fda) : { bytes: 0, partial: false })));
    return { bytes: parts.reduce((a, b) => a + b.bytes, 0), partial: parts.some((x) => x.partial) };
  }
  const sizes = await Promise.all(f.paths.map(async (p) => ((await exists(p)) ? du(p) : 0)));
  return { bytes: sizes.reduce((a, b) => a + b, 0), partial: false };
}

async function last() {
  try {
    const j = JSON.parse(await fs.readFile(RESULT_FILE, 'utf8'));
    return Array.isArray(j.items) ? j : null;
  } catch {
    return null;
  }
}

async function save(result) {
  await fs.mkdir(APP_DIR, { recursive: true });
  const tmp = `${RESULT_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(result));
  await fs.rename(tmp, RESULT_FILE);
}

// usedBytes: espaço usado do volume. "Sistema e outros" = usado − soma das demais pastas.
function analyze(usedBytes) {
  if (running) return running;
  cancelled = false;
  running = (async () => {
    const fda = await disk.hasFullDiskAccess();
    const parts = await Promise.all(FOLDERS.map((f) => measure(f, fda)));
    if (cancelled) return { ok: false, cancelled: true };
    const sizes = parts.map((p) => p.bytes);
    const sum = sizes.reduce((a, b) => a + b, 0);
    const items = FOLDERS.map((f, i) => ({ id: f.id, label: f.label, bytes: sizes[i], canReveal: true, partial: parts[i].partial }));
    items.push({ id: 'system', label: 'Sistema e outros', bytes: Math.max(0, usedBytes - sum), canReveal: false });
    const result = { at: new Date().toISOString(), used: usedBytes, items };
    await save(result).catch(() => {});
    return { ok: true, result };
  })().finally(() => { running = null; children = new Set(); });
  return running;
}

function cancel() {
  cancelled = true;
  for (const c of children) c.kill();
}

// "Mostrar no Finder": só as pastas desta lista, por id.
function pathFor(id) {
  const f = FOLDERS.find((x) => x.id === id);
  if (!f) return null;
  return f.paths.find((p) => require('node:fs').existsSync(p)) || null;
}

module.exports = { analyze, cancel, last, pathFor, isRunning: () => Boolean(running) };
