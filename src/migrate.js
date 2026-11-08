// Migração limpa-mac -> calangoclean (primeira abertura após o renome).
//  - copia config.json, history.log e folders.json da pasta antiga para a nova, SEM apagar a antiga e
//    sem sobrescrever o que já existe na nova;
//  - descarrega (bootout) e apaga o plist do LaunchAgent antigo (com.limpa-mac.auto), para que o novo
//    seja instalado pelo scheduler.sync sem dois agentes rodando;
//  - registra a migração no history.log novo.
// Idempotente: depois de feita, uma nova chamada não encontra nada a fazer e não registra nada.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const OLD_NAME = 'limpa-mac';
const OLD_LABEL = 'com.limpa-mac.auto';
const FILES = ['config.json', 'history.log', 'folders.json'];

function launchctl(args) {
  return new Promise((resolve) => {
    execFile('launchctl', args, { timeout: 15000 }, (err) => resolve({ err }));
  });
}

const exists = (p) => fs.access(p).then(() => true, () => false);

// Opções injetáveis para teste; o padrão usa o HOME real e o launchctl real.
async function run({
  home = os.homedir(),
  newDir = require('./config').APP_DIR,
  run: runLaunchctl = launchctl,
  uid = process.getuid(),
  log = (note) => require('./config').appendHistory(note),
} = {}) {
  const oldDir = path.join(home, 'Library', 'Application Support', OLD_NAME);
  const oldPlist = path.join(home, 'Library', 'LaunchAgents', `${OLD_LABEL}.plist`);
  const copied = [];

  if (await exists(oldDir)) {
    for (const f of FILES) {
      const from = path.join(oldDir, f);
      if (!(await exists(from))) continue;
      await fs.mkdir(newDir, { recursive: true });
      try {
        await fs.copyFile(from, path.join(newDir, f), fs.constants.COPYFILE_EXCL); // nunca sobrescreve
        copied.push(f);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
  }

  let removedAgent = false;
  if (await exists(oldPlist)) {
    await runLaunchctl(['bootout', `gui/${uid}/${OLD_LABEL}`]); // ok falhar se não estava carregado
    await fs.rm(oldPlist, { force: true });
    removedAgent = true;
  }

  if (copied.length || removedAgent) {
    let dryRun = true;
    try { dryRun = JSON.parse(await fs.readFile(path.join(newDir, 'config.json'), 'utf8')).dryRun !== false; } catch { /* mantém true */ }
    await log({
      source: 'migrate', id: 'limpa-mac->calangoclean', dryRun, freedBytes: 0, skipped: false,
      note: `copiado: ${copied.join(', ') || 'nada'}; LaunchAgent antigo removido: ${removedAgent ? 'sim' : 'não'}`,
    });
  }
  return { copied, removedAgent };
}

module.exports = { run, OLD_NAME, OLD_LABEL };
