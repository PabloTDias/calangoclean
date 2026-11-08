const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { dirCategory, HOME } = require('./dirCategory');

const BUNDLE_ID = 'net.whatsapp.WhatsApp';
const APP_PATHS = ['/Applications/WhatsApp.app', path.join(HOME, 'Applications', 'WhatsApp.app')];

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
  });
}

// Só mede e orienta: o app NUNCA apaga nada do WhatsApp (readOnly), porque apagar por fora corrompe o histórico.
// Acima de `highlightAbove` o card sobe para a lista principal com o botão "Abrir WhatsApp".
const whatsapp = dirCategory({
  id: 'whatsapp',
  label: 'WhatsApp',
  level: 'manual',
  hint: 'Limpe pelo app: Ajustes > Armazenamento.',
  detail: 'Mídias e backups do app. Apagar por fora pode corromper o histórico: limpe pelo próprio WhatsApp em Ajustes > Armazenamento > Gerenciar armazenamento. O CalangoClean só mede e abre o WhatsApp; nunca apaga nada dele.',
  dir: path.join(HOME, 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared'),
  mode: 'contents',
  readOnly: true,
  needsFullDisk: true,
});

// O WhatsApp está instalado? (pastas conhecidas; se não achar, pergunta ao Spotlight pelo bundle id)
async function canOpen() {
  for (const p of APP_PATHS) {
    try {
      await fs.access(p);
      return true;
    } catch { /* tenta o próximo */ }
  }
  const r = await run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`]);
  return !r.err && r.stdout.trim().length > 0;
}

// Abre o WhatsApp (comando fixo, sem nada vindo do painel). Não aceita argumentos.
async function openApp() {
  if (!(await canOpen())) return { ok: false, error: 'O WhatsApp não está instalado.' };
  const r = await run('/usr/bin/open', ['-a', 'WhatsApp'], 15000);
  return r.err ? { ok: false, error: 'Não foi possível abrir o WhatsApp.' } : { ok: true };
}

module.exports = Object.assign(whatsapp, {
  highlightAbove: 1e9, // passou de 1 GB (base 10): destaque na lista principal
  featuredHint: 'Limpe em Ajustes > Armazenamento > Gerenciar armazenamento',
  actionLabel: 'Abrir WhatsApp',
  canOpen,
  openApp,
});
