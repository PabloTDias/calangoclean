const path = require('node:path');
const { dirCategory, HOME } = require('./dirCategory');

module.exports = dirCategory({
  id: 'logs',
  label: 'Logs',
  level: 'seguro',
  defaultEnabled: true,
  hint: 'Registros antigos de apps e do sistema.',
  detail: 'Registros antigos de apps e do sistema. Apaga o conteúdo de ~/Library/Logs.',
  dir: path.join(HOME, 'Library', 'Logs'),
  mode: 'contents',
});
