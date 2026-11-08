const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { APP_DIR } = require('./config');

const LABEL = 'com.sejacalango.calangoclean.auto';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Padrões: o executável e o cli.js reais deste app (nunca um usuário fixo).
// ELECTRON_RUN_AS_NODE faz o binário do Electron rodar o cli.js como Node puro,
// então não depende de Node instalado no Mac.
function defaults() {
  return {
    label: LABEL,
    dir: path.join(os.homedir(), 'Library', 'LaunchAgents'),
    programArguments: [process.execPath, path.join(__dirname, 'cli.js'), '--auto'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    logPath: path.join(APP_DIR, 'auto.log'),
  };
}

const withDefaults = (opts = {}) => ({ ...defaults(), ...opts });
const plistPath = (o) => path.join(o.dir, `${o.label}.plist`);

function validate(s) {
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (!int(s.weekday, 0, 6) || !int(s.hour, 0, 23) || !int(s.minute, 0, 59)) {
    throw new Error('Dia ou hora inválidos.');
  }
}

// launchd: Weekday 0 = domingo ... 6 = sábado (mesma numeração do config.json).
function buildPlist(o, schedule) {
  validate(schedule);
  const args = o.programArguments.map((a) => `    <string>${esc(a)}</string>`).join('\n');
  const env = Object.entries(o.env).map(([k, v]) => `    <key>${esc(k)}</key><string>${esc(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>${schedule.weekday}</integer>
    <key>Hour</key><integer>${schedule.hour}</integer>
    <key>Minute</key><integer>${schedule.minute}</integer>
  </dict>
  <key>StandardOutPath</key><string>${esc(o.logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(o.logPath)}</string>
</dict>
</plist>
`;
}

function launchctl(args) {
  return new Promise((resolve) => {
    execFile('launchctl', args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ err, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

const domain = () => `gui/${process.getuid()}`;

async function readPlist(o) {
  try {
    return await fs.readFile(plistPath(o), 'utf8');
  } catch {
    return null;
  }
}

// { installed: plist existe, loaded: o launchd conhece o agente }
async function status(opts) {
  const o = withDefaults(opts);
  const installed = (await readPlist(o)) !== null;
  const loaded = !(await launchctl(['print', `${domain()}/${o.label}`])).err;
  return { installed, loaded };
}

// Grava o plist e carrega no launchd (bootout antes, para aplicar mudanças de horário).
async function install(schedule, opts) {
  const o = withDefaults(opts);
  const xml = buildPlist(o, schedule);
  await fs.mkdir(o.dir, { recursive: true });
  await fs.mkdir(path.dirname(o.logPath), { recursive: true });
  const tmp = plistPath(o) + '.tmp';
  await fs.writeFile(tmp, xml, { mode: 0o644 }); // launchd recusa plist gravável por outros
  await fs.rename(tmp, plistPath(o));
  await launchctl(['bootout', `${domain()}/${o.label}`]); // ok falhar se não estava carregado
  const { err, out } = await launchctl(['bootstrap', domain(), plistPath(o)]);
  if (err) throw new Error(`launchctl bootstrap falhou: ${out || err.message}`);
}

async function uninstall(opts) {
  const o = withDefaults(opts);
  await launchctl(['bootout', `${domain()}/${o.label}`]);
  await fs.rm(plistPath(o), { force: true });
}

// Deixa o launchd de acordo com o config sem reiniciar o agente à toa
// (RunAtLoad dispararia o job de novo a cada bootstrap).
//  - habilitado: garante que o plist está atual e carregado (reinstala só se mudou ou não está carregado);
//  - desabilitado: só descarrega/apaga se `allowUninstall` for true. Isso é reservado ao pedido explícito
//    do usuário (interruptor do painel). Na abertura do app NUNCA se descarrega nada por conta própria.
async function sync(schedule, opts, { allowUninstall = false } = {}) {
  const o = withDefaults(opts);
  const st = await status(o);
  if (!schedule.enabled) {
    // Só mexe no que é nosso: o plist existe neste HOME. Agente carregado sem plist não é tocado.
    if (allowUninstall && st.installed) await uninstall(o);
    return;
  }
  const same = (await readPlist(o)) === buildPlist(o, schedule);
  if (!same || !st.loaded) await install(schedule, o);
}

module.exports = { LABEL, buildPlist, plistPath, withDefaults, status, install, uninstall, sync };
