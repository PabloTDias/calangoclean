const list = [
  require('./caches'),
  require('./logs'),
  require('./chromeServiceWorker'),
  require('./trashOld'),
  require('./devCaches'),
  require('./downloadsLarge'),
  require('./whatsapp'),
  require('./chromeIndexedDB'),
];

const byId = new Map(list.map((c) => [c.id, c]));

// Só 'seguro' e 'atencao' têm checkbox e podem ser limpas pela UI.
const isCleanable = (c) => c.level === 'seguro' || c.level === 'atencao';

function describeAll() {
  return list.map(({ id, label, level, defaultEnabled, hint, detail, highlightAbove, featuredHint, actionLabel, option, requiresBrowserQuit }) => ({
    id, label, level, defaultEnabled, hint, detail: detail || hint,
    // opcionais: categorias que sobem para a lista principal quando passam de um tamanho, com um botão de ação
    highlightAbove, featuredHint, actionLabel, option, requiresBrowserQuit,
  }));
}

module.exports = { all: () => list, describeAll, get: (id) => byId.get(id), isCleanable };
