// Discos externos (pendrive, SSD, HD) montados em /Volumes.
// SOMENTE LEITURA: nada aqui apaga ou limpa. A única ação permitida é ejetar (diskutil eject),
// e só em volumes que esta mesma listagem classificou como externos/removíveis.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const VOLUMES_DIR = '/Volumes';

function run(cmd, args, { timeout = 20000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

// `diskutil info -plist` -> objeto (o plist é convertido para JSON pelo plutil, sem dependências).
async function diskInfo(target) {
  const r = await run('diskutil', ['info', '-plist', target]);
  if (r.err) return null;
  const j = await run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: r.stdout, timeout: 10000 });
  try {
    return JSON.parse(j.stdout);
  } catch {
    return null;
  }
}

function formatName(info) {
  const type = String(info.FilesystemType || '').toLowerCase();
  const name = String(info.FilesystemName || '').toLowerCase();
  if (type === 'apfs') return 'APFS';
  if (type === 'exfat') return 'exFAT';
  if (type === 'msdos') return name.includes('fat16') ? 'FAT16' : name.includes('fat32') ? 'FAT32' : 'FAT';
  if (type === 'hfs') return 'Mac OS Estendido';
  if (type.includes('ntfs')) return 'NTFS';
  return info.FilesystemUserVisibleName || info.FilesystemName || type.toUpperCase() || 'Desconhecido';
}

// Externo ou removível de verdade: fora o disco do sistema, snapshots, imagens .dmg e partições internas.
function isExternalVolume(info, mountPath) {
  if (!info || info.MountPoint !== mountPath) return false; // pasta comum, não é ponto de montagem
  if (info.BusProtocol === 'Disk Image') return false; // .dmg montado
  if (info.APFSSnapshot) return false; // snapshot (inclui o do sistema)
  if (info.SystemImage) return false;
  return info.Internal === false || info.RemovableMedia === true;
}

// Espaço pelo statfs (para APFS o FreeSpace do diskutil vem 0); cai no diskutil se falhar.
async function sizes(mountPath, info) {
  try {
    const st = await fsp.statfs(mountPath);
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bavail) * Number(st.bsize);
    if (total > 0) return { total, free, used: total - free };
  } catch { /* usa o diskutil */ }
  const total = info.TotalSize || info.VolumeSize || 0;
  const free = info.FreeSpace || 0;
  return { total, free, used: Math.max(0, total - free) };
}

// Lista os volumes externos. `dir` só muda em testes.
async function list({ dir = VOLUMES_DIR } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    // oculto (.timemachine...), snapshots locais do Time Machine e o atalho para "/" (symlink)
    if (e.name.startsWith('.') || e.name.startsWith('com.apple.') || e.isSymbolicLink()) continue;
    const mountPath = path.join(dir, e.name);
    const info = await diskInfo(mountPath);
    if (!isExternalVolume(info, mountPath) || seen.has(info.DeviceIdentifier)) continue;
    seen.add(info.DeviceIdentifier);
    out.push({
      id: info.DeviceIdentifier,
      uuid: info.VolumeUUID || null,
      path: mountPath,
      name: info.VolumeName || e.name,
      format: formatName(info),
      kind: info.RemovableMedia === true ? 'usb' : 'drive',
      protocol: info.BusProtocol || null,
      ejectable: info.Ejectable === true,
      writable: info.WritableVolume === true,
      ...(await sizes(mountPath, info)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Mensagem amigável a partir do que o diskutil respondeu.
function friendlyEjectError(text) {
  const t = String(text || '');
  const dissent = t.match(/dissented by PID \d+ \(([^)]+)\)/);
  if (dissent || /busy|in use|couldn't unmount|could not be unmounted|failed to unmount/i.test(t)) {
    const who = dissent ? ` por "${path.basename(dissent[1])}"` : '';
    return `O disco está em uso${who}. Feche os arquivos e programas que o usam e tente de novo.`;
  }
  if (/could not find|not found|no such|not a valid/i.test(t)) return 'Disco não encontrado. Ele já pode ter sido removido.';
  return `Não foi possível ejetar o disco. ${t.trim().split('\n').pop()}`.trim();
}

// Ejeta pelo identificador de um dispositivo (ex.: disk4s1). Usado só por eject() e por testes.
async function runEject(identifier) {
  if (!/^disk\d+(s\d+)*$/.test(identifier)) return { ok: false, error: 'Identificador de disco inválido.' };
  const r = await run('diskutil', ['eject', identifier], { timeout: 60000 });
  if (!r.err) return { ok: true };
  return { ok: false, error: friendlyEjectError(`${r.stdout}\n${r.stderr}`), raw: `${r.stdout}${r.stderr}`.trim() };
}

// Ejeta um volume que esta listagem reconhece como externo. Nunca confia no que o painel manda.
async function eject(id) {
  const v = (await list()).find((x) => x.id === id);
  if (!v) return { ok: false, error: 'Disco não encontrado. Ele já pode ter sido removido.' };
  if (!v.ejectable) return { ok: false, error: 'Este disco não pode ser ejetado por aqui.' };
  return runEject(v.id);
}

// Observa /Volumes (fs.watch, com debounce) e confere por polling enquanto `isActive()` for true.
// Chama onChange(lista) só quando a lista muda (disco novo/removido/renomeado ou espaço livre).
function watch(onChange, { dir = VOLUMES_DIR, debounceMs = 600, pollMs = 5000, isActive = () => true, listFn = list } = {}) {
  let sig = null;
  let timer = null;
  let busy = false;

  async function check() {
    if (busy) return;
    busy = true;
    try {
      const vols = await listFn({ dir });
      const next = JSON.stringify(vols.map((v) => [v.id, v.name, v.format, Math.round(v.free / 1e6)]));
      if (next !== sig) {
        sig = next;
        onChange(vols);
      }
    } finally {
      busy = false;
    }
  }
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => check().catch(() => {}), debounceMs);
  };

  let watcher = null;
  try {
    watcher = fs.watch(dir, soon);
    watcher.on('error', () => {}); // o polling cobre
  } catch { /* sem watcher: só polling */ }
  const poll = setInterval(() => { if (isActive()) check().catch(() => {}); }, pollMs);
  check().catch(() => {});

  return () => {
    clearTimeout(timer);
    clearInterval(poll);
    if (watcher) watcher.close();
  };
}

module.exports = { VOLUMES_DIR, list, eject, runEject, watch, friendlyEjectError, isExternalVolume, formatName };
