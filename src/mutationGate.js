// Coordena ações manuais de arquivos e invalida confirmações antigas da Lixeira.
function create() {
  let busy = false;
  let revision = 0;
  return {
    isBusy: () => busy,
    revision: () => revision,
    changed: () => ++revision,
    async run(fn, { expectedRevision } = {}) {
      if (busy) throw new Error('Outra limpeza está em andamento. Aguarde a conclusão.');
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new Error('O conteúdo da Lixeira mudou. Analise e confirme a limpeza novamente.');
      }
      busy = true;
      try { return await fn(); } finally { busy = false; }
    },
  };
}

module.exports = { create };
