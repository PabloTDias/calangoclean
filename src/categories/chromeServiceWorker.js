const browsers = require('../browsers');
const disk = require('../disk');

// Keep the existing category id so saved selections continue to apply.
function create({ browserService = browsers, storage = disk } = {}) {
  let pending;
  let lastIssue = null;
  const scan = () => {
    if (!pending) pending = browserService.snapshot().finally(() => { pending = null; });
    return pending;
  };
  const bytesOf = s => s.targets.reduce((n, t) => n + t.bytes, 0);
  const runningFor = async s => s.accessIssue || s.measurementError || bytesOf(s) === 0
    ? [] : browserService.running(s.browsers.map(b => b.id));

  async function runningBrowsers() {
    const s = await scan();
    return s.accessIssue ? [] : runningFor(s);
  }

  return {
    id: 'chromeServiceWorker',
    label: 'Cache de navegadores',
    level: 'seguro',
    defaultEnabled: true,
    requiresBrowserQuit: true,
    hint: 'Chrome, Safari, Firefox e outros navegadores.',
    detail: 'Limpa somente caches dos navegadores encontrados, incluindo os perfis do Chrome. Antes de fechar os navegadores, avisa para salvar o trabalho. Cookies, senhas, histórico e sessões são preservados.',
    async detect() { const s = await scan(); return !!s.accessIssue || s.measurementError || s.targets.length > 0; },
    async measure() { return bytesOf(await scan()); },
    async accessIssue() { return (await scan()).accessIssue; },
    async blockedReason() {
      try {
        const list = await runningBrowsers();
        return list.length ? `${list.map(b => b.name).join(', ')}: feche para limpar os caches` : null;
      } catch (e) { return e.message; }
    },
    async details() {
      const s = await scan();
      return s.browsers.map(b => ({ label: b.name, bytes: s.targets.filter(t => t.browserId === b.id).reduce((n, t) => n + t.bytes, 0) }));
    },
    async settings() {
      const s = await scan();
      try { return { runningBrowsers: await runningFor(s), measurementError: s.measurementError, statusReason: s.statusReason || lastIssue }; }
      catch (e) { return { runningBrowsers: [], measurementError: true, statusReason: e.message }; }
    },
    async tip() {
      const s = await scan();
      return [lastIssue, ...(s.problems || [])].filter(Boolean).join('; ') || null;
    },
    async note() {
      if (lastIssue) return lastIssue;
      const s = await scan();
      return s.browsers.length ? s.browsers.map(b => b.name).join(', ') : null;
    },
    runningBrowsers,
    async clean({ dryRun }) {
      lastIssue = null;
      const before = await scan();
      const refused = reason => ({ freedBytes: 0, skipped: true, status: 'failed', reason });
      if (before.accessIssue) return refused(before.accessIssue);
      if (before.measurementError) return refused(before.problems.join('; '));
      const bytes = bytesOf(before);
      if (!bytes) return { freedBytes: 0, skipped: true, reason: 'nada para limpar' };
      // A simulation never closes applications or changes any files.
      if (dryRun) return { freedBytes: bytes, skipped: false, reason: 'simulação' };
      let open;
      try { open = await runningFor(before); } catch (e) { return refused(e.message); }
      const openIds = new Set(open.map(b => b.id));
      const failures = open.map(b => `${b.name}: navegador aberto; salve seu trabalho e feche-o para limpar`);
      for (const t of before.targets) {
        // Recheck before each target: a browser might have been reopened after
        // confirmation. Skip its remaining targets instead of deleting live data.
        try {
          if (openIds.has(t.browserId)) continue;
          if ((await browserService.running([t.browserId])).length) {
            failures.push(`${t.browserName}: navegador foi aberto durante a limpeza`);
            continue;
          }
          const { failures: count, errors = [] } = await storage.removeContents(t.path, t.path);
          if (count) failures.push(`${t.browserName}: ${errors.length ? errors.map(e => e.code).join(', ') : 'não foi possível apagar todos os caches'}`);
        } catch (e) { failures.push(`${t.browserName}: ${e.message}`); }
      }
      const after = await browserService.snapshot();
      if (after.accessIssue || after.measurementError) {
        lastIssue = 'Não foi possível verificar os caches restantes.';
        return { freedBytes: 0, skipped: false, status: 'partial', reason: lastIssue };
      }
      const freedBytes = Math.max(0, bytes - bytesOf(after));
      if (failures.length) lastIssue = [...new Set(failures)].join('; ');
      else if (bytesOf(after) > 0 && freedBytes === 0) lastIssue = 'Os caches permaneceram no disco. Tente novamente com os navegadores fechados.';
      return { freedBytes, skipped: !!lastIssue && freedBytes === 0, status: lastIssue ? freedBytes > 0 ? 'partial' : 'failed' : 'ok', reason: lastIssue || '' };
    },
  };
}

module.exports = { ...create(), create };
