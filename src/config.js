const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const APP_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'calangoclean');
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const HISTORY_FILE = path.join(APP_DIR, 'history.log');

// Instalação nova usa limpeza real; dryRun pode ser ligado no config.json para simular.
// Congelado: ninguém altera os padrões por engano (uma cópia mutada contaminava o processo todo).
const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};
const DEFAULTS = deepFreeze({
  dryRun: false,
  appearance: 'automatico',
  soundEnabled: true,
  categories: {},
  trashDays: 7,
  // Desligado por padrão: nada é agendado até o usuário ligar no painel.
  schedule: { enabled: false, weekday: 1, hour: 8, minute: 30, minDaysBetween: 5 },
  lastRun: null, // última limpeza REAL (manual ou automática); simulação nunca grava isso
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class ConfigError extends Error {}

// Lê o arquivo como está. null = o arquivo NÃO existe (única situação em que valem os padrões).
// Arquivo que existe mas não dá para ler/interpretar lança erro: nunca vira "padrões".
async function readRaw() {
  let text;
  try {
    text = await fs.readFile(CONFIG_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new ConfigError(`Não foi possível ler o config.json (${e.code || e.message}).`);
  }
  try {
    const raw = JSON.parse(text);
    if (!isObj(raw)) throw new Error('o conteúdo não é um objeto');
    return raw;
  } catch (e) {
    throw new ConfigError(`config.json inválido: ${e.message}`);
  }
}

// Visão em memória: o que o usuário definiu, com padrões só para o que está faltando.
function withDefaults(raw) {
  const { lastAutoRun, ...rest } = clone(raw ?? {}); // campo antigo (simulações o gravavam): descartado
  const base = clone(DEFAULTS);
  return {
    ...base,
    ...rest,
    appearance: ['normal', 'noturno', 'automatico'].includes(rest.appearance) ? rest.appearance : base.appearance,
    categories: { ...base.categories, ...(isObj(rest.categories) ? rest.categories : {}) },
    schedule: { ...base.schedule, ...(isObj(rest.schedule) ? rest.schedule : {}) },
  };
}

// Config para uso normal. Lança ConfigError se o arquivo existir e estiver ilegível.
async function load() {
  return withDefaults(await readRaw());
}

// Só para EXIBIR na tela. Nunca use o resultado para gravar nem para mexer no launchd.
async function loadSafe() {
  try {
    return { cfg: await load(), error: null };
  } catch (e) {
    return { cfg: { ...withDefaults(null), dryRun: true }, error: e.message };
  }
}

// Todas as gravações passam por uma fila: duas alterações simultâneas (ex.: "Desmarcar tudo"
// dispara várias de uma vez) não se atropelam nem perdem dados.
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function writeAtomic(config) {
  await fs.mkdir(APP_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n');
  await fs.rename(tmp, CONFIG_FILE); // troca atômica: nunca deixa o config pela metade
}

// Lista de mudanças (caminho -> valor) entre duas visões.
function changes(before, after, prefix = []) {
  const out = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k];
    const b = after[k];
    const p = [...prefix, k];
    if (isObj(a) && isObj(b)) out.push(...changes(a, b, p));
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: p, remove: b === undefined, value: b });
  }
  return out;
}

function setPath(obj, p, value, remove) {
  let o = obj;
  for (const k of p.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  if (remove) delete o[p[p.length - 1]];
  else o[p[p.length - 1]] = value;
}

// Lê, aplica `mutate(cfg)` e grava, tudo dentro da fila. Devolve a visão nova (com padrões).
//  - arquivo não existe (primeira instalação): nasce com os padrões + a mudança;
//  - arquivo existe: grava SÓ o que a mudança alterou, em cima do conteúdo que está no disco.
//    Chaves que o usuário não definiu continuam ausentes (padrão não vira valor gravado);
//  - arquivo ilegível: lança erro e não grava nada.
function update(mutate) {
  return exclusive(async () => {
    const raw = await readRaw();
    const view = withDefaults(raw);
    const before = clone(view);
    await mutate(view);
    if (raw === null) {
      await writeAtomic(view);
      return view;
    }
    const legacy = 'lastAutoRun' in raw;
    const diff = changes(before, view);
    if (!diff.length && !legacy) return view; // nada mudou: nem reescreve o arquivo
    const next = clone(raw);
    delete next.lastAutoRun;
    for (const c of diff) setPath(next, c.path, c.value, c.remove);
    await writeAtomic(next);
    return view;
  });
}

// Persiste a escolha (marcado/desmarcado) de uma categoria.
const setCategoryEnabled = (id, enabled) => update((cfg) => { cfg.categories[id] = Boolean(enabled); });

// Migração única para produção, inclusive em instalações que herdaram dryRun: true.
// Depois dela, uma simulação configurada explicitamente continua sendo respeitada.
function enableProduction() {
  return update((cfg) => {
    if (cfg.productionModeVersion === 1) return;
    cfg.dryRun = false;
    cfg.productionModeVersion = 1;
  });
}

// Remove do arquivo o campo antigo lastAutoRun (se existir), sem tocar no resto.
async function cleanLegacy() {
  try {
    const raw = await readRaw();
    if (raw && 'lastAutoRun' in raw) await update(() => {});
  } catch { /* sem config ou ilegível: não mexe */ }
}

// Uma linha por categoria executada (inclusive simulações).
async function appendHistory({ source = 'ui', id, dryRun, freedBytes, skipped, reason, note, status }) {
  const line = [
    new Date().toISOString(),
    source,
    id,
    dryRun ? 'dry-run' : 'real',
    `freed=${freedBytes}`,
    status === 'partial' || status === 'failed' ? `${status} (${reason})`
      : skipped ? `skipped (${reason})` : reason && !dryRun ? `ok (${reason})` : 'ok',
    ...(note ? [note] : []),
  ].join(' | ');
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.appendFile(HISTORY_FILE, line + '\n');
}

module.exports = { APP_DIR, CONFIG_FILE, HISTORY_FILE, DEFAULTS, ConfigError, load, loadSafe, update, cleanLegacy, enableProduction, setCategoryEnabled, appendHistory };
