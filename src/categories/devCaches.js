const os = require('node:os');
const path = require('node:path');
const disk = require('../disk');

function errorReason(error, action = 'ler') {
  if (['EACCES', 'EPERM'].includes(error?.code)) return `sem permissão para ${action} o cache`;
  if (error?.code === 'EBUSY') return 'cache em uso';
  return error?.message || `não foi possível ${action} o cache`;
}

// Usa somente pastas de cache conhecidas. Um cache configurado para outro lugar
// não autoriza apagar uma pasta arbitrária da home, nem seguir links simbólicos.
function create({ home = os.homedir(), diskTools = disk } = {}) {
  const tools = [
    { name: 'brew', roots: ['Library/Caches/Homebrew', '.cache/Homebrew'] },
    { name: 'npm', roots: ['.npm', 'Library/Caches/npm', '.cache/npm'] },
    { name: 'pip3', roots: ['Library/Caches/pip', '.cache/pip'] },
  ].map(t => ({ ...t, roots: t.roots.map(p => path.join(home, p)) }));
  const cacheRoots = tools.flatMap(t => t.roots);
  let memo = null;
  let lastReason = '';

  async function measureEntries(entries) {
    const measured = [];
    const errors = [];
    for (const entry of entries) {
      try {
        // Valida também na análise/simulação: nunca aprova um link ou um caminho
        // que não poderia apagar. dirSize strict recusa totais parciais do du.
        await diskTools.assertSafeTarget(entry.cache, entry.cache);
        const access = await diskTools.access(entry.cache);
        if (access === 'missing') continue;
        if (access === 'denied') throw Object.assign(new Error(), { code: 'EACCES' });
        const bytes = await diskTools.dirSize(entry.cache, { strict: true });
        measured.push({ ...entry, bytes: bytes ?? 0 });
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        errors.push({ name: entry.name, reason: errorReason(e), code: e.code });
      }
    }
    return { entries: measured, errors, bytes: measured.reduce((n, e) => n + e.bytes, 0) };
  }

  async function scan({ fresh = false } = {}) {
    if (!fresh && memo && Date.now() - memo.at < 400) return memo.promise;
    const promise = (async () => {
      const found = await Promise.all(tools.map(async t => ({ ...t, installed: !!(await diskTools.findCommand(t.name)) })));
      const installed = found.filter(t => t.installed);
      const entries = installed.flatMap(t => t.roots.map(cache => ({ name: t.name, cache })));
      return { ...(await measureEntries(entries)), installed };
    })();
    memo = { at: Date.now(), promise };
    promise.catch(() => { if (memo?.promise === promise) memo = null; });
    return promise;
  }

  const describeErrors = s => s.errors.map(e => `${e.name}: ${e.reason}`).join('; ');

  async function clean({ dryRun }) {
    lastReason = '';
    const before = await scan({ fresh: true });
    if (!before.installed.length) return { freedBytes: 0, skipped: true, reason: 'brew, npm e pip3 não encontrados' };
    if (before.errors.length) {
      lastReason = describeErrors(before);
      return { freedBytes: 0, skipped: true, status: 'failed', reason: lastReason };
    }
    if (!before.bytes) return { freedBytes: 0, skipped: true, reason: 'nada para limpar' };
    if (dryRun) return { freedBytes: before.bytes, skipped: false, reason: 'simulação' };

    const failures = [];
    for (const entry of before.entries) {
      try {
        // Não chama brew cleanup: ele também remove versões de pacotes fora
        // do cache e preserva downloads atuais que estavam incluídos no total.
        const result = await diskTools.removeContents(entry.cache, entry.cache);
        if (result.failures) {
          const errors = result.errors?.length ? result.errors : (result.errorCodes || []).map(code => ({ code }));
          const reasons = [...new Set(errors.map(e => errorReason(e, 'apagar')))];
          failures.push(`${entry.name}: ${result.failures} item(ns) mantido(s)${reasons.length ? ` (${reasons.join(', ')})` : ''}`);
        }
      } catch (e) {
        failures.push(`${entry.name}: ${errorReason(e, 'apagar')}`);
      }
    }

    // Revalida exatamente as pastas medidas antes de limpar. Não conta como
    // liberado um cache que deixou de ser detectado ou que não pôde ser lido.
    const after = await measureEntries(before.entries);
    memo = null;
    if (after.errors.length) {
      lastReason = `Não foi possível confirmar a limpeza. ${describeErrors(after)}`;
      return { freedBytes: 0, skipped: true, status: 'failed', reason: lastReason };
    }
    const freedBytes = Math.max(0, before.bytes - after.bytes);
    if (after.bytes && !failures.length) failures.push('Parte do cache foi mantida ou recriada por ferramentas em uso.');
    lastReason = failures.join('; ');
    return { freedBytes, skipped: !!lastReason && !freedBytes,
      status: lastReason ? (freedBytes ? 'partial' : 'failed') : 'ok', reason: lastReason };
  }

  return {
    id: 'devCaches', label: 'Caches de dev', level: 'seguro', defaultEnabled: false,
    hint: 'Caches de brew, npm e pip3 (os que existirem).',
    detail: 'Limpa as pastas padrão de cache de Homebrew, npm e pip3 instalados, sem remover pacotes. Caches configurados em outras pastas são preservados.',
    cacheRoots,
    detect: async () => (await scan()).installed.length > 0,
    measure: async () => (await scan()).bytes,
    accessIssue: async () => (await scan()).errors.some(e => ['EPERM', 'EACCES'].includes(e.code))
      ? 'sem permissão para ler o cache (dê Acesso Total ao Disco ao app)' : null,
    blockedReason: async () => null,
    details: async () => (await scan()).entries.map(e => ({ label: e.name, bytes: e.bytes })),
    settings: async () => {
      const s = await scan();
      return { measurementError: s.errors.length > 0, statusReason: describeErrors(s) || lastReason };
    },
    clean,
  };
}

module.exports = { ...create(), create };
