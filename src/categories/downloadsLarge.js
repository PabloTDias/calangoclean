const path = require('node:path');
const disk = require('../disk');
const { HOME } = require('./dirCategory');

const DIR = path.join(HOME, 'Downloads');
const RULE = { minBytes: 500e6, minAgeDays: 60 }; // 500 MB em base 10, como a UI exibe

// Só lista. Nunca apaga: o usuário decide no Finder.
module.exports = {
  id: 'downloadsLarge',
  label: 'Downloads grandes e antigos',
  level: 'revisar',
  defaultEnabled: false,
  hint: 'Arquivos > 500 MB com mais de 60 dias.',
  detail: 'Arquivos com mais de 500 MB e mais de 60 dias em Downloads. Só lista: revise e apague pelo Finder.',

  async detect() {
    return (await disk.access(DIR)) !== 'missing';
  },
  async accessIssue() {
    return (await disk.access(DIR)) === 'denied' ? 'sem permissão para ler Downloads' : null;
  },
  async blockedReason() { return null; },
  async measure() {
    return (await this.details()).reduce((s, f) => s + f.bytes, 0);
  },
  // Cada linha tem `path` para o botão "Mostrar no Finder".
  async details() {
    if ((await disk.access(DIR)) !== 'ok') return [];
    const files = await disk.findLargeOld(DIR, RULE);
    return files.map((f) => ({ label: f.name, bytes: f.bytes, path: f.path }));
  },
  async clean() {
    return { freedBytes: 0, skipped: true, reason: 'somente listagem' };
  },
  DIR,
};
