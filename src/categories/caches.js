const path = require('node:path');
const { dirCategory, HOME } = require('./dirCategory');

module.exports = dirCategory({
  id: 'caches',
  label: 'Caches de apps',
  level: 'seguro',
  defaultEnabled: true,
  hint: 'Temporários que os apps recriam.',
  detail: 'Arquivos temporários que os apps recriam sozinhos em ~/Library/Caches. Caches de navegadores e ferramentas de desenvolvimento são tratados nas categorias próprias. Itens protegidos são mantidos e o motivo é informado.',
  dir: path.join(HOME, 'Library', 'Caches'),
  mode: 'contents',
  excludePaths: () => [
    ...require('../browsers').excludedCacheRoots(),
    ...require('./devCaches').cacheRoots,
  ],
});
