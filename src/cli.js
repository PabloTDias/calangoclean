// Modo headless chamado pelo launchd:  cli.js --auto [--force]
// Regras (CLAUDE.md): só categorias de nível 'seguro' que o usuário marcou; respeita
// minDaysBetween; nunca atropela o dryRun do config; registra no history.log e notifica.
const { execFile } = require('node:child_process');
const config = require('./config');
const disk = require('./disk');
const categories = require('./categories');

const DAY = 86400000;
const { fmt } = require('./format');

const stamp = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const say = (msg) => console.log(`${stamp()} - ${msg}`);

function notify(title, text) {
  if (process.env.LIMPA_NO_NOTIFY) return Promise.resolve();
  const clean = (s) => String(s).replace(/["\\]/g, '');
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `display notification "${clean(text)}" with title "${clean(title)}"`], () => resolve());
  });
}

// Categorias que o modo automático pode tocar: nível seguro E marcadas pelo usuário.
function eligible(cfg) {
  return categories.all().filter((c) => c.level === 'seguro' && (cfg.categories[c.id] ?? c.defaultEnabled));
}

async function runAuto({ force = false, now = Date.now() } = {}) {
  const cfg = await config.load();
  const { dryRun } = cfg;

  if (!cfg.schedule.enabled && !force) {
    say('Agendamento desativado. Nada a fazer.');
    return { status: 'disabled' };
  }

  // Só limpezas reais contam para o intervalo; simulação nunca grava nem lê data.
  await config.cleanLegacy();
  const last = Date.parse(cfg.lastRun) || 0;
  const minDays = cfg.schedule.minDaysBetween;
  if (!force && last && now - last < minDays * DAY) {
    const reason = `última execução há menos de ${minDays} dias`;
    say(`Nada a fazer: ${reason}.`);
    await config.appendHistory({ source: 'auto', id: '-', dryRun, freedBytes: 0, skipped: true, reason });
    return { status: 'too-soon' };
  }

  const before = (await disk.getDiskInfo()).free;
  let freed = 0;
  let ran = 0;
  const skipped = [];
  for (const cat of eligible(cfg)) {
    const r = await cat.clean({ dryRun });
    await config.appendHistory({ source: 'auto', id: cat.id, dryRun, ...r });
    say(`${cat.id}: ${r.skipped ? `pulada (${r.reason})` : `${fmt(r.freedBytes)}${dryRun ? ' (simulação)' : ''}`}`);
    if (r.skipped) skipped.push(cat.id);
    else { freed += r.freedBytes; ran++; }
  }

  // Relê o config para não sobrescrever o que o painel salvou durante a execução.
  // Só marca a data se algo foi limpo de verdade (real e ao menos uma categoria executada).
  if (!dryRun && ran > 0) {
    await config.update((fresh) => { fresh.lastRun = new Date(now).toISOString(); });
  }

  const free = (await disk.getDiskInfo()).free;
  const text = dryRun
    ? `Simulação: ~${fmt(freed)} seriam liberados. Nada foi apagado.`
    : `Liberado ~${fmt(freed)}. Livre: ${fmt(free)}.`;
  say(text);
  await notify('CalangoClean', text);
  return { status: 'done', dryRun, freed, ran, skipped, before, free };
}

module.exports = { runAuto, eligible, fmt };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.includes('--auto')) {
    console.log('Uso: cli.js --auto [--force]\n  --force  ignora o intervalo mínimo e o agendamento desligado (continua respeitando o dryRun)');
    process.exit(args.length ? 1 : 0);
  }
  runAuto({ force: args.includes('--force') }).then(
    () => process.exit(0),
    (e) => { console.error(`${stamp()} - erro: ${e.message}`); process.exit(1); },
  );
}
