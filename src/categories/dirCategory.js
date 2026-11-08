const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const disk = require('../disk');

const HOME = os.homedir();
const DENIED = 'sem permissão (dê Acesso Total ao Disco ao app)';
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function issue(error, target, action) {
  const code = error?.code || 'UNKNOWN';
  const reason = ['EPERM', 'EACCES'].includes(code) ? `Sem permissão para ${action} este item.`
    : code === 'EBUSY' ? 'Item em uso.'
    : code === 'UNSAFE_TARGET' ? 'Caminho recusado por segurança.'
    : error?.message || `Não foi possível ${action} este item (${code}).`;
  return { path: target, name: path.basename(target), code, reason };
}

// Mede e limpa entradas independentes. Uma pasta protegida pelo macOS não impede
// a limpeza dos outros caches; os tamanhos parciais e erros ficam explícitos.
function dirCategory({ id, label, level, defaultEnabled = false, hint = '', detail, dir, mode,
  blockedBy, readOnly = false, needsFullDisk = false, describe, excludePaths = [] }) {
  const noFda = async () => needsFullDisk && !(await disk.hasFullDiskAccess());
  let memo = null;
  let lastFailures = new Map();

  async function detect() {
    if (await noFda()) return true;
    return (await disk.access(dir)) !== 'missing';
  }

  async function candidates(excluded, errors, parent = dir) {
    const out = [];
    let names;
    try { names = await fs.readdir(parent); } catch (e) {
      if (e.code !== 'ENOENT') errors.push(issue(e, parent, 'ler'));
      return out;
    }
    for (const name of names) {
      const target = path.join(parent, name);
      if (excluded.some(root => inside(target, root))) continue;
      // Ex.: excluir Google/Chrome preserva os caches dos demais apps de Google.
      if (excluded.some(root => inside(root, target))) {
        try {
          const st = await fs.lstat(target);
          if (st.isDirectory() && !st.isSymbolicLink()) {
            out.push(...await candidates(excluded, errors, target));
            continue;
          }
        } catch (e) {
          if (e.code !== 'ENOENT') errors.push(issue(e, target, 'ler'));
          continue;
        }
      }
      out.push(target);
    }
    return out;
  }

  async function scan({ fresh = false } = {}) {
    if (!fresh && memo && Date.now() - memo.at < 400) return memo.promise;
    const promise = (async () => {
      const s = { entries: [], bytes: 0, errors: [], accessIssue: null };
      if (await noFda()) { s.accessIssue = DENIED; return s; }
      const access = await disk.access(dir);
      if (access === 'denied') { s.accessIssue = DENIED; return s; }
      if (access === 'missing') return s;
      const excluded = (typeof excludePaths === 'function' ? await excludePaths() : excludePaths).map(p => path.resolve(p));
      const paths = mode === 'self' ? [dir] : await candidates(excluded, s.errors);
      for (const target of paths) {
        try {
          const bytes = await disk.dirSize(target, { strict: true });
          if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Não foi possível medir este item.');
          s.entries.push({ path: target, bytes });
          s.bytes += bytes;
        } catch (e) {
          if (e.code !== 'ENOENT') s.errors.push(issue(e, target, 'ler'));
        }
      }
      return s;
    })();
    memo = { at: Date.now(), promise };
    promise.catch(() => { if (memo?.promise === promise) memo = null; });
    return promise;
  }

  const reasonFor = s => {
    const current = new Map(s.errors.map(e => [e.path, e]));
    for (const entry of s.entries) {
      if (!current.has(entry.path) && lastFailures.has(entry.path)) current.set(entry.path, lastFailures.get(entry.path));
    }
    return [...current.values()].map(e => `${e.name}: ${e.reason}`).join(' ');
  };

  async function settings() {
    const s = await scan();
    const details = reasonFor(s);
    const remainingCount = lastFailures.size;
    return {
      measurementError: s.errors.length > 0 && s.entries.length === 0,
      measurementPartial: s.errors.length > 0 && s.entries.length > 0,
      statusReason: !details ? '' : s.errors.length ? 'Algumas pastas não puderam ser analisadas' : 'Alguns arquivos foram mantidos',
      statusDetails: details,
      remainingCount,
    };
  }

  async function blockedReason() {
    return blockedBy && (await disk.isProcessRunning(blockedBy)) ? `${blockedBy} está aberto` : null;
  }

  async function details() {
    if (await noFda()) return [];
    return describe && (await disk.access(dir)) === 'ok' ? describe(dir) : [];
  }

  async function clean({ dryRun }) {
    if (readOnly) return { freedBytes: 0, skipped: true, reason: 'somente leitura' };
    lastFailures = new Map();
    const before = await scan({ fresh: true });
    if (before.accessIssue) return { freedBytes: 0, skipped: true, status: 'failed', reason: before.accessIssue };
    if (!before.entries.length || before.bytes === 0) return {
      freedBytes: 0, skipped: true, status: before.errors.length ? 'failed' : undefined,
      reason: reasonFor(before) || 'nada para limpar',
    };
    const blocked = await blockedReason();
    if (blocked) return { freedBytes: 0, skipped: true, reason: `${blocked}; feche e tente de novo` };
    try { await disk.assertSafeTarget(dir, dir); } catch (e) {
      return { freedBytes: 0, skipped: true, status: 'failed', reason: `caminho recusado: ${e.message}` };
    }
    if (dryRun) return { freedBytes: before.bytes, skipped: false,
      status: before.errors.length ? 'partial' : 'ok', reason: ['simulação', reasonFor(before)].filter(Boolean).join('; ') };

    let removal;
    try {
      removal = await disk.removePaths(before.entries.map(e => e.path), dir);
    } catch (e) { removal = { errors: [issue(e, dir, 'apagar')] }; }
    memo = null;
    // Verifica cada alvo original: apps abertos podem recriar outros caches
    // enquanto a limpeza acontece, alterando a soma da pasta inteira.
    let freedBytes = 0, removedCount = 0;
    const failures = [...before.errors];
    for (const entry of before.entries) {
      try {
        const remaining = await disk.dirSize(entry.path, { strict: true });
        if (!Number.isFinite(remaining)) throw new Error('Não foi possível confirmar a limpeza.');
        freedBytes += Math.max(0, entry.bytes - remaining);
        const error = removal.errors?.find(e => e.path === entry.path) ||
          { code: removal.errorCodes?.[0] || 'REMAINING', message: 'O cache continua no disco; o app pode tê-lo recriado.' };
        failures.push(issue(error, entry.path, 'apagar'));
      } catch (e) {
        if (e.code === 'ENOENT') { freedBytes += entry.bytes; removedCount++; }
        else failures.push(issue(e, entry.path, 'confirmar a limpeza de'));
      }
    }
    lastFailures = new Map(failures.map(e => [e.path, e]));
    memo = null;
    const status = failures.length ? (removedCount || freedBytes ? 'partial' : 'failed') : 'ok';
    return { freedBytes, skipped: status === 'failed', status, failures,
      userMessage: failures.length ? 'Alguns arquivos foram mantidos' : '',
      remainingCount: failures.length, reason: failures.map(e => `${e.name}: ${e.reason}`).join(' ') };
  }

  return { id, label, level, defaultEnabled, hint, detail: detail || hint, dir, detect,
    measure: async () => (await scan()).bytes,
    accessIssue: async () => (await scan()).accessIssue,
    blockedReason, details, settings, clean };
}

module.exports = { dirCategory, HOME, DENIED };
