// Dispositivos Bluetooth conectados, com bateria quando o aparelho informa.
// SOMENTE LEITURA: lê `system_profiler SPBluetoothDataType -json`; nunca conecta, desconecta nem altera nada.
// Não é importado pelo cli.js, então o agendamento nunca roda isto.
const { execFile } = require('node:child_process');

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const FALLBACK_NAME = 'Dispositivo Bluetooth';

function run(cmd, args, { timeout = 15000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve({ err, stdout: String(stdout || '') }));
    if (input !== undefined) child.stdin.end(input);
  });
}

// Endereço em forma canônica para cruzar as fontes: "64-0b-d7-1b-a4-24" / "64:0B:..." -> "64:0b:d7:1b:a4:24"
const normAddr = (a) => String(a || '').trim().toLowerCase().replace(/-/g, ':');

// "85%" -> 85; ausente/ilegível -> null
function pct(v) {
  const n = parseInt(String(v ?? '').replace('%', ''), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

// Nome igual ao de Ajustes > Bluetooth. Se vier um MAC como nome, tenta outros campos de nome.
function displayName(key, props) {
  const clean = (s) => (typeof s === 'string' ? s.trim() : '');
  const candidates = [key, props.device_name, props.device_productName, props.device_friendlyName];
  for (const c of candidates) {
    const s = clean(c);
    if (s && !MAC_RE.test(s)) return s;
  }
  return FALLBACK_NAME;
}

// Tipo para escolher o ícone.
function kindOf(minorType, name) {
  const t = `${minorType || ''} ${name || ''}`.toLowerCase();
  if (/keyboard|teclado/.test(t)) return 'keyboard';
  if (/mouse|pebble|trackball/.test(t)) return 'mouse';
  if (/trackpad/.test(t)) return 'trackpad';
  if (/headset|headphone|airpods|earbud|speaker|fone/.test(t)) return 'headphones';
  if (/game|controller|gamepad/.test(t)) return 'gamepad';
  return 'other';
}

// Bateria: o nível principal; sem ele, o menor entre esquerdo/direito (fones). Caixa de carga não conta.
function batteryOf(p) {
  const main = pct(p.device_batteryLevelMain);
  if (main !== null) return main;
  const sides = [pct(p.device_batteryLevelLeft), pct(p.device_batteryLevelRight)].filter((n) => n !== null);
  return sides.length ? Math.min(...sides) : null;
}

// Teclados/mouses da Apple não trazem a bateria no system_profiler; ela vem do ioreg (BatteryPercent),
// por endereço do aparelho. Lê o texto de `ioreg -r -k BatteryPercent -l` (o plist tem campos binários que
// o plutil não converte para JSON), agrupando as propriedades por nó. Retorna Map(endereço canônico -> 0..100).
function parseIoregBattery(text) {
  const map = new Map();
  let addr = null;
  let serial = null;
  let level = null;
  const flush = () => {
    const a = normAddr(addr || serial);
    if (level !== null && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(a)) map.set(a, level);
    addr = serial = level = null;
  };
  for (const line of String(text).split('\n')) {
    if (/\+-o /.test(line)) flush();
    let m;
    if ((m = line.match(/"DeviceAddress"\s*=\s*"([^"]+)"/))) addr = m[1];
    else if ((m = line.match(/"SerialNumber"\s*=\s*"([^"]+)"/))) serial = m[1];
    else if ((m = line.match(/"BatteryPercent"\s*=\s*(\d+)/))) level = pct(m[1]);
  }
  flush();
  return map;
}

async function ioregBattery() {
  const r = await run('/usr/sbin/ioreg', ['-r', '-k', 'BatteryPercent', '-l']);
  return r.err ? new Map() : parseIoregBattery(r.stdout);
}

function parse(json, ioreg = new Map()) {
  const ctl = (json && json.SPBluetoothDataType && json.SPBluetoothDataType[0]) || {};
  const out = [];
  for (const entry of ctl.device_connected || []) {
    for (const [key, props] of Object.entries(entry || {})) {
      const name = displayName(key, props || {});
      out.push({
        id: String((props && props.device_address) || key),
        name,
        kind: kindOf(props && props.device_minorType, name),
        // 0..100 ou null (sem dados da bateria): system_profiler primeiro, depois o ioreg pelo endereço
        battery: batteryOf(props || {}) ?? ioreg.get(normAddr(props && props.device_address)) ?? null,
      });
    }
  }
  return out;
}

async function list() {
  const [r, ioreg] = await Promise.all([run('/usr/sbin/system_profiler', ['SPBluetoothDataType', '-json']), ioregBattery()]);
  if (r.err) return [];
  try {
    return parse(JSON.parse(r.stdout), ioreg);
  } catch {
    return [];
  }
}

module.exports = { list, parse, parseIoregBattery, displayName, kindOf };
