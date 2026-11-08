// Orquestra a limpeza manual. O fechamento de navegadores exige a confirmação
// exibida no painel; agendamento e simulação nunca enviam comandos de saída.
function create({ categories, browsers }) {
  let busy = false;

  async function clean(ids, { dryRun, closeBrowsers = false, skipBrowsers = false, onResult = async () => {} }) {
    if (busy) throw new Error('Já existe uma limpeza em andamento.');
    busy = true;
    const results = [];
    try {
      for (const id of new Set(Array.isArray(ids) ? ids : [])) {
        const cat = categories.get(id);
        if (!cat || !categories.isCleanable(cat)) continue;
        if (skipBrowsers === true && cat.requiresBrowserQuit) continue;
        let result;
        let quitFailures = [];
        try {
          if (cat.requiresBrowserQuit && !dryRun) {
            const running = await cat.runningBrowsers();
            if (running.length && closeBrowsers !== true) {
              result = {
                freedBytes: 0, skipped: true, status: 'failed',
                reason: 'Confirme o aviso de fechamento dos navegadores antes de limpar seus caches.',
              };
            } else if (running.length) {
              const quit = await browsers.quit(running.map((browser) => browser.id));
              quitFailures = quit.failed;
            }
          }
          result ||= await cat.clean({ dryRun });
          if (quitFailures.length) {
            const reason = quitFailures.map((browser) => `${browser.name}: ${browser.reason}`).join('; ');
            result = {
              ...result,
              status: result.freedBytes > 0 ? 'partial' : 'failed',
              reason: [result.reason, reason].filter(Boolean).join('; '),
            };
          }
        } catch (e) {
          result = { freedBytes: 0, skipped: true, status: 'failed', reason: e.message || 'Falha ao limpar a categoria.' };
        }
        await onResult(id, result);
        results.push({ id, ...result });
      }
      return { dryRun, results };
    } finally { busy = false; }
  }

  return { clean };
}

module.exports = { create };
