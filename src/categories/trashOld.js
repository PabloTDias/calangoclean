const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');
const disk = require('../disk');
const trashFinder = require('../trashFinder');
const { HOME, DENIED } = require('./dirCategory');

const DEFAULT_DIR = path.join(HOME, '.Trash');

function describeError(error, action = 'apagar') {
  const code = error?.code;
  if (code === -1743) return { code, permissionKind: 'automation', reason: 'Sem autorização para controlar o Finder. Permita o CalangoClean em Privacidade e Segurança > Automação > Finder.' };
  if (code === 'EACCES' || code === 'EPERM' || code === -54 || code === -5000) return { code, reason: `Sem permissão para ${action} este item.` };
  if (code === -45) return { code, reason: 'Item bloqueado pelo macOS.' };
  if (code === 'EBUSY' || code === -47) return { code, reason: 'Item em uso.' };
  if (code === -128) return { code, reason: 'Esvaziamento cancelado no Finder.' };
  if (code === -1712 || error?.killed) return { code, reason: 'O Finder não concluiu a operação a tempo. Confira a Lixeira no Finder.' };
  return { code: code || 'UNKNOWN', reason: error?.message
    ? `${error.message}${code ? ` (${code})` : ''}` : `Não foi possível concluir a operação${code ? ` (${code})` : ''}.` };
}

// Pastas injetadas nos testes usam somente a remoção local. A Lixeira real usa
// a listagem e o comando nativos do Finder quando o usuário escolhe Tudo.
function create({ dir = DEFAULT_DIR, getDays = async () => (await config.load()).trashDays,
  now = Date.now, finder = dir === DEFAULT_DIR ? trashFinder : null } = {}) {
  let memo = null;
  let lastFailures = new Map();

  async function parseDays() {
    const n = Number(await getDays());
    return Number.isFinite(n) && n >= 0 ? n : 7;
  }

  async function scan({ fresh = false, days: fixedDays, paths: fixedPaths } = {}) {
    const days = fixedDays ?? await parseDays();
    if (!fresh && memo && memo.days === days && now() - memo.at < 400) return memo.promise;
    const promise = (async () => {
      const s = { days, entries: [], eligible: 0, eligibleCount: 0, errors: [], accessIssue: null, permissionKind: null };
      const access = await disk.access(dir);
      if (access === 'denied') {
        s.accessIssue = DENIED;
        s.permissionKind = 'fullDisk';
        return s;
      }
      let paths;
      try {
        paths = fixedPaths ?? (finder && days === 0 ? await finder.list()
          : access === 'missing' ? [] : (await fs.readdir(dir)).map(n => path.join(dir, n)));
      } catch (e) {
        const issue = describeError(e, 'ler');
        if (issue.permissionKind) {
          s.accessIssue = issue.reason;
          s.permissionKind = issue.permissionKind;
        } else s.errors.push({ ...issue, name: 'Lixeira' });
        return s;
      }
      const cutoff = now() - days * 86400000;
      for (const p of [...new Set(paths)]) {
        let eligible = days === 0;
        try {
          const st = await fs.lstat(p);
          eligible ||= st.ctimeMs < cutoff;
          if (!eligible) continue;
          const bytes = (await disk.dirSize(p, { strict: true })) ?? 0;
          s.entries.push({ path: p, bytes });
          s.eligible += bytes;
          s.eligibleCount++;
        } catch (e) {
          if (e.code === 'ENOENT') continue;
          s.entries.push({ path: p, bytes: null });
          s.eligibleCount++;
          s.errors.push({ ...describeError(e, 'ler'), path: p, name: path.basename(p) });
        }
      }
      return s;
    })();
    memo = { at: now(), days, promise };
    promise.catch(() => { if (memo?.promise === promise) memo = null; });
    return promise;
  }

  function statusReason(s) {
    const errors = s.errors.length ? s.errors : s.entries.map(e => lastFailures.get(e.path)).filter(Boolean);
    return errors.map(e => `${e.name}: ${e.reason}`).join(' ');
  }

  async function settings() {
    const s = await scan();
    return { days: s.days, eligibleCount: s.eligibleCount, measurementError: s.errors.length > 0,
      permissionKind: s.permissionKind, statusReason: statusReason(s) };
  }

  async function clean({ dryRun }) {
    lastFailures = new Map();
    const before = await scan({ fresh: true });
    if (before.accessIssue) return { freedBytes: 0, skipped: true, status: 'failed', reason: before.accessIssue };
    if (before.errors.length) return { freedBytes: 0, skipped: true, status: 'failed', reason: statusReason(before) };
    const entries = before.entries.map(e => e.path);
    if (!entries.length) return { freedBytes: 0, skipped: true, reason: 'nada para limpar' };
    const native = finder && before.days === 0;
    // Nenhuma operação do Finder é feita em simulação. A remoção local mantém
    // a validação de prefixo inclusive quando o usuário está só simulando.
    if (!native) {
      try { await disk.assertSafeTarget(dir, dir); } catch (e) {
        return { freedBytes: 0, skipped: true, status: 'failed', reason: `caminho recusado: ${e.message}` };
      }
    }
    if (dryRun) return { freedBytes: before.eligible, skipped: false, reason: 'simulação' };

    let operationError = null;
    let removal = { errors: [] };
    try {
      if (native) await finder.empty();
      else removal = await disk.removePaths(entries, dir);
    } catch (e) { operationError = describeError(e); }
    finally { memo = null; }

    let after;
    // Uma remoção parcial muda o ctime das pastas. A verificação local precisa
    // examinar os alvos originais, sem aplicar de novo o filtro de idade.
    try { after = await scan({ fresh: true, days: 0, paths: native ? undefined : entries }); } catch (e) {
      return { freedBytes: 0, skipped: true, status: 'failed', reason: describeError(e).reason };
    }
    if (after.accessIssue || after.errors.length) {
      return { freedBytes: 0, skipped: true, status: 'failed', reason:
        `Não foi possível confirmar o esvaziamento. ${after.accessIssue || statusReason(after)}` };
    }

    // Só considera removido o que realmente desapareceu. A listagem nativa
    // inclui também os itens da Lixeira nos outros volumes montados.
    const remaining = new Map(after.entries.map(e => [e.path, e]));
    let freedBytes = 0, removedCount = 0;
    for (const entry of before.entries) {
      const rest = remaining.get(entry.path);
      if (!rest) { freedBytes += entry.bytes; removedCount++; }
      else freedBytes += Math.max(0, entry.bytes - rest.bytes);
    }
    const failures = [];
    for (const entry of after.entries) {
      const error = operationError || removal.errors?.find(e => e.path === entry.path) ||
        (removal.errorCodes?.[0] ? { code: removal.errorCodes[0] } : null);
      const issue = error?.reason ? error : error ? describeError(error)
        : { code: 'REMAINING', reason: 'O item continua na Lixeira; o Finder não informou o motivo.' };
      const failure = { ...issue, name: path.basename(entry.path), path: entry.path,
        reason: native && operationError ? `O Finder interrompeu o esvaziamento. ${issue.reason}` : issue.reason };
      failures.push(failure);
      lastFailures.set(entry.path, failure);
    }
    memo = null; // faz a próxima análise refletir também os motivos por item
    const incomplete = failures.length > 0;
    const status = incomplete ? (removedCount || freedBytes ? 'partial' : 'failed') : 'ok';
    return {
      freedBytes, skipped: status === 'failed', status, remainingCount: failures.length,
      reason: incomplete ? failures.map(e => `${e.name}: ${e.reason}`).join(' ')
        : operationError ? operationError.reason : '',
      failures,
    };
  }

  return {
    id: 'trashOld', label: 'Lixeira', level: 'atencao', defaultEnabled: true,
    hint: '', detail: 'Exclusão permanente dos itens selecionados da Lixeira.', option: 'trashDays', dir,
    detect: async () => (finder && await parseDays() === 0) || (await disk.access(dir)) !== 'missing',
    measure: async () => (await scan()).eligible,
    note: async () => statusReason(await scan()) || null,
    settings,
    accessIssue: async () => (await scan()).accessIssue,
    blockedReason: async () => null,
    details: async () => [],
    invalidate: () => { memo = null; },
    clean,
  };
}

module.exports = create();
module.exports.create = create;
module.exports.describeError = describeError;
