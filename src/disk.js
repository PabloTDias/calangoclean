const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DATA_VOL = '/System/Volumes/Data';

function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

// Espaço do volume de dados, em bytes.
async function getDiskInfo() {
  const { stdout } = await run('df', ['-k', DATA_VOL]);
  const cols = (stdout.trim().split('\n')[1] || '').split(/\s+/);
  const total = Number(cols[1]) * 1024;
  const free = Number(cols[3]) * 1024;
  if (!Number.isFinite(total) || !Number.isFinite(free)) {
    throw new Error('Não foi possível ler o espaço em disco.');
  }
  return { total, free, used: total - free };
}

// Tamanho de um caminho em bytes; null se não existir.
// `du` sai com erro em pastas sem permissão, mas ainda imprime o total parcial.
async function dirSize(p, { strict = false } = {}) {
  if (strict) await fs.lstat(p);
  else if (!(await exists(p))) return null;
  const { err, stdout, stderr } = await run('du', ['-skP', p]);
  if (strict && err) {
    // A leitura parcial nunca vira um tamanho completo ou 0 B na Lixeira.
    throw Object.assign(new Error(stderr.trim() || 'Não foi possível medir o item.'), {
      code: /Operation not permitted|Permission denied/i.test(stderr) ? 'EACCES' : 'MEASURE_FAILED',
    });
  }
  const kb = parseInt(stdout.split('\t')[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

// Caminhos que nunca podem ser tocados (regra 6), mesmo que alguém registre errado.
// /Volumes: discos externos são somente leitura; nenhuma categoria de limpeza pode atuar neles.
const FORBIDDEN = ['/System', '/Library', '/private', '/usr', '/bin', '/sbin', '/etc', '/var', '/Volumes'];

// Garante que `target` é seguro para apagar:
//  - o caminho resolvido começa com o prefixo esperado da categoria (e está na home);
//  - não está em área proibida;
//  - nem ele nem nenhum pai é link simbólico (realpath == caminho resolvido).
async function assertSafeTarget(target, expectedPrefix) {
  const t = path.resolve(target);
  const prefix = path.resolve(expectedPrefix);
  const home = os.homedir();
  const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

  if (FORBIDDEN.some((f) => inside(t, f))) throw new Error('área protegida (sistema ou disco externo)');
  if (!inside(t, prefix)) throw new Error(`fora do prefixo esperado (${prefix})`);
  if (!inside(t, home) || t === home) throw new Error('fora da pasta do usuário');

  let st;
  try {
    st = await fs.lstat(t);
  } catch {
    return t; // não existe: nada a apagar
  }
  if (st.isSymbolicLink()) throw new Error('é um link simbólico');
  if ((await fs.realpath(t)) !== t) throw new Error('caminho passa por link simbólico');
  return t;
}

// Remove cada caminho de `paths`, sempre validando contra `expectedPrefix`.
// Links simbólicos são removidos como link (unlink), nunca seguidos; o pai precisa ser seguro.
async function removePaths(paths, expectedPrefix) {
  let failures = 0;
  const errorCodes = new Set();
  const errors = [];
  for (const p of paths) {
    try {
      const st = await fs.lstat(p);
      if (st.isSymbolicLink()) {
        await assertSafeTarget(path.dirname(p), expectedPrefix);
        if (path.resolve(p) === path.resolve(expectedPrefix)) throw new Error('prefixo é link');
        await fs.unlink(p);
      } else {
        await assertSafeTarget(p, expectedPrefix);
        await fs.rm(p, { recursive: true, force: true });
      }
    } catch (e) {
      if (e.code === 'ENOENT') continue; // já removido por outro processo
      failures++;
      errorCodes.add(e.code || 'UNSAFE_TARGET');
      errors.push({ path: p, code: e.code || 'UNSAFE_TARGET' });
    }
  }
  return { failures, errorCodes: [...errorCodes], errors };
}

// Apaga o conteúdo de `dir` (equivale a `rm -rf dir/*`), sem tocar na pasta em si.
async function removeContents(dir, expectedPrefix) {
  const safe = await assertSafeTarget(dir, expectedPrefix);
  let entries;
  try {
    entries = await fs.readdir(safe);
  } catch {
    return { failures: 1 };
  }
  return removePaths(entries.map((n) => path.join(safe, n)), expectedPrefix);
}

// Apaga a própria pasta (equivale a `rm -rf dir`).
async function removeDir(dir, expectedPrefix) {
  const safe = await assertSafeTarget(dir, expectedPrefix);
  try {
    await fs.rm(safe, { recursive: true, force: true });
    return { failures: 0 };
  } catch {
    return { failures: 1 };
  }
}

// 'ok' | 'missing' | 'denied'. Pasta protegida pelo macOS passa no lstat mas falha no readdir.
async function access(p) {
  let st;
  try {
    st = await fs.lstat(p);
  } catch (e) {
    return e.code === 'ENOENT' ? 'missing' : 'denied';
  }
  if (!st.isDirectory()) return 'ok';
  try {
    await fs.readdir(p);
    return 'ok';
  } catch {
    return 'denied';
  }
}

// Arquivos grandes e antigos sob `root`. Não segue links simbólicos. Somente leitura.
async function findLargeOld(root, { minBytes, minAgeDays }) {
  const cutoff = Date.now() - minAgeDays * 86400000;
  const out = [];
  async function walk(dir) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile()) {
        try {
          const st = await fs.lstat(p);
          if (st.size >= minBytes && st.mtimeMs < cutoff) {
            out.push({ path: p, name: e.name, bytes: st.size, mtimeMs: st.mtimeMs });
          }
        } catch { /* arquivo sumiu */ }
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => b.bytes - a.bytes);
}

// PATH de app gráfico não tem Homebrew nem nvm; monta um parecido com o do terminal.
async function toolPath() {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  try {
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const versions = (await fs.readdir(nvm)).sort();
    if (versions.length) dirs.unshift(path.join(nvm, versions[versions.length - 1], 'bin'));
  } catch { /* sem nvm */ }
  return dirs;
}

// Caminho absoluto do comando se existir e puder rodar; senão null.
async function findCommand(name) {
  for (const dir of await toolPath()) {
    const full = path.join(dir, name);
    try {
      await fs.access(full, fs.constants.X_OK);
    } catch {
      continue;
    }
    // /usr/bin/pip3 é um atalho que abre o instalador do Xcode CLT se ele não existir.
    if (dir === '/usr/bin' && (await run('xcode-select', ['-p'], { timeout: 5000 })).err) return null;
    return full;
  }
  return null;
}

// Roda um comando (sem shell) com o PATH das ferramentas.
async function runTool(cmd, args, { timeout = 300000 } = {}) {
  const PATH = (await toolPath()).join(':');
  return new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, PATH }, maxBuffer: 16 * 1024 * 1024, timeout }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || '').trim() });
    });
  });
}

let machineCache = null;

// Modelo do Mac ("Mac mini", "Apple M2"). Nunca lê nem devolve número de série.
async function getMachineInfo() {
  if (machineCache) return machineCache;
  let name = null;
  let chip = null;
  const { err, stdout } = await run('system_profiler', ['SPHardwareDataType', '-json'], { timeout: 15000 });
  if (!err) {
    try {
      const hw = JSON.parse(stdout).SPHardwareDataType[0];
      name = hw.machine_name || null;
      chip = hw.chip_type || hw.cpu_type || null;
    } catch { /* cai no fallback */ }
  }
  if (!name) name = (await run('sysctl', ['-n', 'hw.model'], { timeout: 5000 })).stdout.trim() || 'Mac';
  machineCache = { name, chip };
  return machineCache;
}

// Nome do volume de inicialização ("Macintosh HD").
async function getVolumeName() {
  const { stdout } = await run('diskutil', ['info', '/'], { timeout: 10000 });
  const m = stdout.match(/Volume Name:\s*(.+)/);
  return (m && m[1].trim()) || 'Macintosh HD';
}

// Tem Acesso Total ao Disco? Descobre SEM tocar em dados de outros apps (Group Containers, Chrome etc.,
// que fazem o macOS avisar "tentou acessar seus dados a partir de outros apps"). Usa pastas do próprio
// macOS que só se leem com Acesso Total ao Disco e cuja negação é silenciosa: se uma delas abre, tem acesso;
// se dá erro de permissão, não tem; se não existe (ENOENT), tenta a próxima. Sem resposta, assume que NÃO tem.
const FDA_PROBES = ['Safari', 'Messages', 'Mail'].map((n) => path.join(os.homedir(), 'Library', n));

async function hasFullDiskAccess(probes = FDA_PROBES) {
  for (const p of probes) {
    try {
      await fs.readdir(p);
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }
  }
  return false;
}

async function isProcessRunning(name) {
  const { err } = await run('pgrep', ['-x', name], { timeout: 5000 });
  return !err;
}

module.exports = {
  getDiskInfo,
  getMachineInfo,
  getVolumeName,
  dirSize,
  exists,
  assertSafeTarget,
  access,
  removePaths,
  findLargeOld,
  findCommand,
  runTool,
  removeContents,
  removeDir,
  isProcessRunning,
  hasFullDiskAccess,
};
