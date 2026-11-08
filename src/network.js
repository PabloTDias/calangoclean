// Rede: tipo de conexão ativa, IP local e teste de velocidade sob demanda.
// A leitura é leve (route/networksetup/ipconfig). O teste de velocidade (networkQuality) consome
// banda e ~20 s: SÓ roda quando o usuário clica em "Testar velocidade" (IPC 'network:speed').
// Este módulo nunca é importado pelo cli.js, então o agendamento jamais o executa.
const os = require('node:os');
const { execFile } = require('node:child_process');

const NETWORK_QUALITY = '/usr/bin/networkQuality';

function run(cmd, args, { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// "Hardware Port: Wi-Fi\nDevice: en1\n..." -> [{ port, device }]
function parseHardwarePorts(text) {
  const out = [];
  let port = null;
  for (const line of String(text).split('\n')) {
    const p = line.match(/^Hardware Port:\s*(.+)$/);
    const d = line.match(/^Device:\s*(\S+)/);
    if (p) port = p[1].trim();
    else if (d && port) { out.push({ port, device: d[1] }); port = null; }
  }
  return out;
}

// Nome da porta de hardware -> tipo de conexão.
function typeFromPort(port, device = '') {
  if (/^utun|^ipsec|^ppp/.test(device)) return 'vpn';
  if (/wi-?fi|airport/i.test(port || '')) return 'wifi';
  if (/ethernet|\blan\b|thunderbolt|usb/i.test(port || '')) return 'ethernet';
  return 'other';
}

// O macOS esconde o SSID ("<redacted>") de qualquer app sem permissão de Localização.
const hidden = (s) => !s || /redacted/i.test(s);

function parseSsid(text) {
  const t = String(text);
  const a = t.match(/Current (?:Wi-Fi|AirPort) Network:\s*(.+)/i);
  const b = t.match(/^\s*SSID\s*:\s*(.+)$/m);
  const name = (a && a[1]) || (b && b[1]) || null;
  return hidden(name) ? null : name.trim();
}

async function wifiName(device) {
  const a = await run('/usr/sbin/networksetup', ['-getairportnetwork', device], { timeout: 5000 });
  let name = parseSsid(a.stdout);
  if (!name) name = parseSsid((await run('/usr/sbin/ipconfig', ['getsummary', device], { timeout: 5000 })).stdout);
  return name;
}

// Conexão ativa: a interface da rota padrão.
async function getInfo() {
  const route = await run('/sbin/route', ['-n', 'get', 'default'], { timeout: 5000 });
  const iface = (route.stdout.match(/interface:\s*(\S+)/) || [])[1];
  if (route.err || !iface) return { connected: false };

  const ports = parseHardwarePorts((await run('/usr/sbin/networksetup', ['-listallhardwareports'], { timeout: 5000 })).stdout);
  const entry = ports.find((p) => p.device === iface);
  const type = typeFromPort(entry && entry.port, iface);
  const ip = (os.networkInterfaces()[iface] || []).find((a) => a.family === 'IPv4' && !a.internal);

  const label = type === 'wifi' ? 'Wi-Fi' : type === 'ethernet' ? 'Ethernet' : type === 'vpn' ? 'VPN' : (entry && entry.port) || iface;
  let name = null;
  if (type === 'wifi') name = await wifiName(iface);
  return {
    connected: true,
    type,
    label,
    name, // null quando o macOS esconde o SSID
    ssidHidden: type === 'wifi' && !name,
    interface: iface,
    ip: ip ? ip.address : null,
  };
}

// Código de erro do networkQuality (NSURLError) -> mensagem em pt-BR.
function friendlyError(code, domain) {
  if ([-1009, -1020].includes(code)) return 'Sem conexão com a internet. Verifique o Wi-Fi ou o cabo e tente de novo.';
  if ([-1001, -1003, -1004, -1005, -1006, -1200].includes(code)) {
    return 'Não foi possível alcançar o servidor de teste da Apple. Verifique a conexão e tente de novo.';
  }
  return `O teste de velocidade falhou${code !== undefined ? ` (${domain || 'erro'} ${code})` : ''}.`;
}

// Saída do `networkQuality -c` -> resultado ou erro. Atenção: com erro ele sai com código 0 e
// devolve error_code no JSON, então só o código de saída não basta.
function parseSpeed(stdout) {
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    return { ok: false, error: 'Não foi possível ler o resultado do teste de velocidade.' };
  }
  if (j.error_code !== undefined) return { ok: false, error: friendlyError(j.error_code, j.error_domain) };
  if (typeof j.dl_throughput !== 'number' || typeof j.ul_throughput !== 'number') {
    return { ok: false, error: 'O teste terminou sem resultado. Tente de novo.' };
  }
  return {
    ok: true,
    downMbps: j.dl_throughput / 1e6, // bits/s -> Mbps (base 10)
    upMbps: j.ul_throughput / 1e6,
    latencyMs: typeof j.base_rtt === 'number' ? j.base_rtt : null,
    interface: j.interface_name || null,
  };
}

let current = null; // teste em andamento (um por vez)
let child = null;

// Roda o teste. Só chamado pelo clique do usuário; ignora cliques repetidos enquanto roda.
function speedTest({ bin = NETWORK_QUALITY } = {}) {
  if (current) return current;
  current = new Promise((resolve) => {
    child = execFile(bin, ['-c', '-M', '60'], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      child = null;
      if (err && err.code === 'ENOENT') {
        return resolve({ ok: false, error: 'Este macOS não tem o networkQuality (requer macOS 12 ou mais novo).' });
      }
      if (err && err.killed) return resolve({ ok: false, error: 'O teste demorou demais e foi interrompido.' });
      if (err && !stdout.trim()) return resolve({ ok: false, error: 'Não foi possível executar o teste de velocidade.' });
      resolve(parseSpeed(stdout));
    });
  }).finally(() => { current = null; });
  return current;
}

function cancel() {
  if (child) child.kill();
}

module.exports = { getInfo, speedTest, cancel, parseHardwarePorts, typeFromPort, parseSsid, parseSpeed, friendlyError };
