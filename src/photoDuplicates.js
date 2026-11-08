// Arquivos exatamente iguais, somente por pedido do usuário. Nenhuma função deste
// módulo apaga arquivos: a única mutação possível é trashItem, injetada pelo main.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { kindFor, isCompatibleHeader, contentValidator, IMAGE_EXTENSIONS } = require('./duplicateFileTypes');

const SIDECARS = new Set(['.mov', '.mp4', '.aae', '.xmp', '.json', '.dng', '.raw', '.cr2', '.cr3', '.nef', '.arw', '.orf', '.raf', '.rw2', '.pef']);
const VIDEO_SIDECARS = new Set(['.aae', '.xmp', '.json', '.srt', '.vtt', '.thm', '.lrv', '.xml', '.dng', '.raw', '.cr2', '.cr3', '.nef', '.arw', '.orf', '.raf', '.rw2', '.pef']);
const PROJECT_MARKERS = new Set(['.git', '.hg', '.svn', 'package.json', 'cargo.toml', 'pyproject.toml', 'pom.xml', 'composer.json', 'gemfile', 'go.mod', 'package.swift', 'makefile', 'cmakelists.txt', 'requirements.txt', 'setup.py', '.project', '.classpath']);
const BLOCKED_NAMES = new Set(['library', 'applications', 'system', 'private', 'usr', 'bin', 'sbin', 'etc', 'var', 'opt', 'volumes', 'windows', 'winnt', 'system32', 'syswow64', 'program files', 'program files (x86)', 'programdata', 'appdata', 'contents', 'resources', 'frameworks', 'plugins', 'plug-ins', 'lib', 'lib64', 'include', 'node_modules', 'vendor', 'backups', 'backups.backupdb', 'lost+found', 'system volume information']);
const BUNDLES = /\.(app|appex|xpc|bundle|framework|plugin|kext|component|vst|vst3|audiounit|qlgenerator|mdimporter|prefpane|saver|service|workflow|action|scptd|osax|driver|dsym|dll|dylib|so|exe|pkg|mpkg|msi|dmg|photoslibrary|photolibrary|aplibrary|migratedphotolibrary|imovielibrary|musiclibrary|sparsebundle|backupbundle|xcodeproj|xcworkspace|playground|pages|numbers|key|rtfd|band|logicx|logic|garageband|fcpbundle|fcpproject|lrdata|lrcat|scriv|sketch|omnigraffle|graffle|pixelmator|pxd|acorn|artb|procreate)$/i;
const CLOUD = /^(?:icloud(?: drive)?|dropbox(?:\b|$)|onedrive(?:\b|[- ]|$)|google[ -]?drive(?:\b|[- ]|$)|box(?: sync| drive)?$|cloudstorage$|mobile documents$)/i;
const BLOCKED_XATTR = /(?:resourcefork|finderinfo|icloud|fileprovider|ubiquit|dropbox|onedrive|googledrive|google\.drive|boxsync)/i;
const CHUNK = 256 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const identity = st => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':');
const publicFile = file => ({ id: file.id, name: file.name, path: file.path, bytes: file.bytes, modifiedAt: file.modifiedAt, kind: file.kind, extension: file.extension });

function blockedName(name) {
  return name.startsWith('.') || BLOCKED_NAMES.has(name.toLowerCase()) || BUNDLES.test(name) || CLOUD.test(name);
}

const isProjectMarker = name => PROJECT_MARKERS.has(name.toLowerCase()) || /\.(?:xcodeproj|xcworkspace|csproj|vbproj|fsproj|sln)$/i.test(name);

function command(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

// Compara também atributos estendidos: cópias com tags ou metadados diferentes
// não são equivalentes. Finder aliases/resource forks e itens de nuvem ficam fora.
async function inspectMacMetadata(filename) {
  if (process.platform !== 'darwin') return { eligible: false, reason: 'A leitura de metadados exige macOS.' };
  const attrs = (await command('/usr/bin/xattr', ['--', filename])).trim().split('\n').filter(Boolean).sort();
  if (attrs.some(name => BLOCKED_XATTR.test(name))) return { eligible: false, reason: 'Arquivo especial ou gerenciado por outro aplicativo.' };
  const hash = createHash('sha256');
  for (const name of attrs) {
    const value = await command('/usr/bin/xattr', ['-px', '--', name, filename]);
    hash.update(name).update('\0').update(value.replace(/\s/g, '')).update('\0');
  }
  return { eligible: true, fingerprint: hash.digest('hex') };
}

function create({ home = os.homedir(), mode = 'photos', trashItem, inspectMetadata = inspectMacMetadata, onProgress = () => {} } = {}) {
  if (!['photos', 'files'].includes(mode)) throw new Error('Modo de busca inválido.');
  home = path.resolve(home);
  const definitions = mode === 'photos' ? [['pictures', 'Imagens', 'Pictures'], ['downloads', 'Downloads', 'Downloads']]
    : [['downloads', 'Downloads', 'Downloads'], ['documents', 'Documentos', 'Documents'], ['desktop', 'Mesa', 'Desktop'], ['movies', 'Filmes', 'Movies'], ['music', 'Música', 'Music']];
  const availableRoots = new Map(definitions.map(([id, label, folder]) => [id, { id, label, path: path.join(home, folder) }]));
  let busy = false;
  let cancelled = false;
  let state = { mode, rootIds: [], scanId: null, groups: [], stats: { examined: 0, photos: 0, files: 0, skipped: 0, errors: 0 }, cancelled: false, scannedAt: null };
  let groups = [];
  let filesById = new Map();
  let homeDevice;

  const roots = () => clone([...availableRoots.values()]);
  const snapshot = () => clone(state);
  const cancel = () => { if (busy) cancelled = true; };
  const checkCancelled = () => { if (cancelled) throw Object.assign(new Error('Busca cancelada.'), { code: 'CANCELLED' }); };

  async function ensurePath(filename, { directory = false, checkProjects = false } = {}) {
    const target = path.resolve(filename);
    if (!inside(target, home) || target === home) throw new Error('Escolha uma pasta pessoal dentro do seu usuário.');
    const parts = path.relative(home, target).split(path.sep);
    if (parts.some(blockedName)) throw new Error('Sistema, aplicativos, nuvem e bibliotecas ficam fora desta busca.');
    const homeStat = await fs.lstat(home);
    if (homeStat.isSymbolicLink()) throw new Error('A pasta do usuário não pode ser um link.');
    homeDevice = homeStat.dev;
    if ((await fs.realpath(target)) !== target) throw new Error('O caminho passa por um link simbólico.');
    let current = home;
    let st;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      st = await fs.lstat(current);
      if (st.isSymbolicLink() || st.dev !== homeDevice) throw new Error('Links e outros volumes ficam fora desta busca.');
      if (i < parts.length - 1 && !st.isDirectory()) throw new Error('Pasta inválida.');
      if (checkProjects && st.isDirectory()) {
        const names = await fs.readdir(current);
        if (names.some(isProjectMarker)) throw new Error('Pastas de projetos são preservadas.');
      }
    }
    if (directory && !st.isDirectory()) throw new Error('Escolha uma pasta.');
    return st;
  }

  async function addRoot(filename) {
    if (busy) throw new Error('Aguarde a operação atual antes de adicionar uma pasta.');
    const rootPath = path.resolve(filename);
    await ensurePath(rootPath, { directory: true, checkProjects: true });
    const existing = [...availableRoots.values()].find(root => root.path === rootPath);
    if (existing) return clone(existing);
    const root = { id: randomUUID(), label: path.basename(rootPath), path: rootPath };
    availableRoots.set(root.id, root);
    return clone(root);
  }

  function relatedMediaIndex(entries) {
    const photo = new Set();
    const video = new Set();
    for (const name of entries) {
      const extension = path.extname(name).toLowerCase();
      const stem = name.slice(0, -extension.length).toLowerCase();
      if (SIDECARS.has(extension)) photo.add(stem);
      if (VIDEO_SIDECARS.has(extension) || IMAGE_EXTENSIONS.has(extension)) video.add(stem);
    }
    return { photo, video };
  }

  function relatedMediaPresent(filename, index) {
    const name = path.basename(filename);
    const extension = path.extname(name).toLowerCase();
    const kind = kindFor(extension, mode);
    if (!['photo', 'video'].includes(kind)) return false;
    const stem = name.slice(0, -extension.length).toLowerCase();
    return index[kind].has(stem) || index[kind].has(name.toLowerCase());
  }

  async function sidecarPresent(filename) {
    if (!['photo', 'video'].includes(kindFor(path.extname(filename).toLowerCase(), mode))) return false;
    return relatedMediaPresent(filename, relatedMediaIndex(await fs.readdir(path.dirname(filename))));
  }

  async function validateFile(file, { metadata = true } = {}) {
    const st = await ensurePath(file.path, { checkProjects: true });
    if (!st.isFile() || st.nlink !== 1 || st.size <= 0 || (st.mode & 0o111) || !kindFor(path.extname(file.path).toLowerCase(), mode)) throw new Error('Este item não é um arquivo pessoal independente compatível.');
    if (identity(st) !== file.identity) throw new Error('O arquivo mudou desde a análise. Faça uma nova busca.');
    if (await sidecarPresent(file.path)) throw new Error('Este arquivo faz parte de um conjunto que será preservado.');
    if (metadata) {
      const meta = await inspectMetadata(file.path, st);
      if (!meta?.eligible || typeof meta.fingerprint !== 'string') throw new Error(meta?.reason || 'Não foi possível verificar os metadados do arquivo.');
      if (file.metadata !== undefined && meta.fingerprint !== file.metadata) throw new Error('Os metadados do arquivo mudaram desde a análise.');
      return { st, metadata: meta.fingerprint };
    }
    return { st };
  }

  async function openFile(file) {
    await validateFile(file);
    const handle = await fs.open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      if (identity(await handle.stat()) !== file.identity) throw new Error('O arquivo mudou durante a leitura.');
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }

  async function hashFile(file) {
    const meta = await validateFile(file);
    file.metadata = meta.metadata;
    const handle = await openFile(file);
    try {
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(CHUNK);
      const validator = contentValidator(file.extension);
      let position = 0;
      for (;;) {
        checkCancelled();
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        const chunk = buffer.subarray(0, bytesRead);
        if (position === 0 && !isCompatibleHeader(chunk, file.extension)) throw new Error('O conteúdo não corresponde a um arquivo pessoal compatível.');
        validator.chunk(chunk);
        hash.update(chunk);
        position += bytesRead;
      }
      validator.finish();
      if (position !== file.bytes || identity(await handle.stat()) !== file.identity) throw new Error('O arquivo mudou durante a leitura.');
      await validateFile(file);
      return hash.digest('hex');
    } finally { await handle.close(); }
  }

  async function equalFiles(a, b) {
    const first = await openFile(a);
    let second;
    try {
      second = await openFile(b);
      const left = Buffer.allocUnsafe(CHUNK);
      const right = Buffer.allocUnsafe(CHUNK);
      let position = 0;
      for (;;) {
        checkCancelled();
        const [one, two] = await Promise.all([first.read(left, 0, CHUNK, position), second.read(right, 0, CHUNK, position)]);
        if (one.bytesRead !== two.bytesRead || !left.subarray(0, one.bytesRead).equals(right.subarray(0, two.bytesRead))) return false;
        if (!one.bytesRead) break;
        position += one.bytesRead;
      }
      if (position !== a.bytes || identity(await first.stat()) !== a.identity || identity(await second.stat()) !== b.identity) throw new Error('Um arquivo mudou durante a comparação.');
      await validateFile(a);
      await validateFile(b);
      return true;
    } finally { await first.close(); if (second) await second.close(); }
  }

  function updateGroups(nextGroups) {
    groups = nextGroups.filter(group => group.files.length >= 2);
    filesById = new Map(groups.flatMap(group => group.files.map(file => [file.id, file])));
    state.groups = groups.map(group => ({ id: group.id, bytes: group.files[0].bytes, files: group.files.map(publicFile) }));
  }

  async function scan(rootIds) {
    if (busy) throw new Error('Já existe uma operação de duplicados em andamento.');
    if (!Array.isArray(rootIds) || !rootIds.length || rootIds.some(id => !availableRoots.has(id))) throw new Error('Escolha pelo menos uma pasta válida.');
    busy = true;
    cancelled = false;
    state = { mode, rootIds: [...new Set(rootIds)], scanId: randomUUID(), groups: [], stats: { examined: 0, photos: 0, files: 0, skipped: 0, errors: 0 }, cancelled: false, scannedAt: null, issues: [] };
    updateGroups([]);
    const found = [];
    const seen = new Set();
    const stats = state.stats;
    const report = async (phase, processed = 0, total = 0) => { await onProgress({ mode, phase, ...stats, processed, total }); checkCancelled(); };
    const issue = (filename, error) => {
      stats.errors++;
      if (state.issues.length < 20) state.issues.push({ path: filename, reason: error.message || 'Não foi possível ler este item.' });
    };
    async function walk(dir) {
      checkCancelled();
      await ensurePath(dir, { directory: true });
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (entries.some(entry => isProjectMarker(entry.name))) { stats.skipped++; return; }
      const relatedMedia = relatedMediaIndex(entries.map(entry => entry.name));
      for (const entry of entries) {
        checkCancelled();
        const filename = path.join(dir, entry.name);
        if (seen.has(filename)) continue;
        seen.add(filename);
        if (blockedName(entry.name) || entry.isSymbolicLink()) { stats.skipped++; continue; }
        try {
          if (entry.isDirectory()) await walk(filename);
          else {
            stats.examined++;
            const ext = path.extname(entry.name).toLowerCase();
            const kind = kindFor(ext, mode);
            if (!entry.isFile() || !kind || relatedMediaPresent(filename, relatedMedia)) { stats.skipped++; continue; }
            const st = await ensurePath(filename);
            if (!st.isFile() || st.nlink !== 1 || st.size <= 0 || (st.mode & 0o111)) { stats.skipped++; continue; }
            stats.files++;
            if (kind === 'photo') stats.photos++;
            found.push({ id: randomUUID(), name: entry.name, path: filename, bytes: st.size, modifiedAt: new Date(st.mtimeMs).toISOString(), identity: identity(st), kind, extension: ext });
          }
        } catch (error) { if (error.code === 'CANCELLED') throw error; issue(filename, error); }
        if ((stats.examined + stats.skipped) % 32 === 0) await report('walking');
      }
    }
    try {
      await report('walking');
      // Raízes sobrepostas não duplicam uma entrada física na lista.
      const selectedRoots = [...new Set(rootIds)].map(id => availableRoots.get(id));
      for (const root of selectedRoots) {
        try { await ensurePath(root.path, { directory: true, checkProjects: true }); await walk(root.path); }
        catch (error) { if (error.code === 'CANCELLED') throw error; issue(root.path, error); }
      }
      const sizes = new Map();
      for (const file of found) { if (!sizes.has(file.bytes)) sizes.set(file.bytes, []); sizes.get(file.bytes).push(file); }
      const candidates = [...sizes.values()].filter(files => files.length > 1).flat();
      const hashes = new Map();
      let processed = 0;
      await report('hashing', processed, candidates.length);
      for (const file of candidates) {
        try {
          const hash = await hashFile(file);
          const key = `${file.bytes}:${hash}:${file.metadata}`;
          if (!hashes.has(key)) hashes.set(key, []);
          hashes.get(key).push(file);
        } catch (error) { if (error.code === 'CANCELLED') throw error; stats.skipped++; issue(file.path, error); }
        await report('hashing', ++processed, candidates.length);
      }
      const matching = [...hashes.values()].filter(files => files.length > 1);
      const matches = [];
      processed = 0;
      await report('comparing', 0, matching.length);
      for (const files of matching) {
        const confirmed = [files[0]];
        for (const file of files.slice(1)) {
          try { if (await equalFiles(files[0], file)) confirmed.push(file); }
          catch (error) { if (error.code === 'CANCELLED') throw error; stats.skipped++; issue(file.path, error); }
        }
        if (confirmed.length > 1) matches.push({ id: randomUUID(), files: confirmed });
        await report('comparing', ++processed, matching.length);
      }
      matches.sort((a, b) => (b.files.length - 1) * b.files[0].bytes - (a.files.length - 1) * a.files[0].bytes);
      updateGroups(matches);
    } catch (error) {
      if (error.code !== 'CANCELLED') throw error;
      state.cancelled = true;
      // Uma busca interrompida nunca habilita uma remoção parcial.
      updateGroups([]);
    } finally {
      state.scannedAt = new Date().toISOString();
      busy = false;
    }
    return snapshot();
  }

  async function safeFile(id) {
    const file = filesById.get(id);
    if (!file) throw new Error('Arquivo indisponível. Faça uma nova busca.');
    await validateFile(file);
    return publicFile(file);
  }

  async function trash({ scanId, ids, dryRun } = {}) {
    if (busy) throw new Error('Já existe uma operação de duplicados em andamento.');
    if (!scanId || scanId !== state.scanId || state.cancelled) throw new Error('A análise mudou. Faça uma nova busca e confirme novamente.');
    if (typeof dryRun !== 'boolean') throw new Error('Modo de limpeza inválido.');
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !filesById.has(id))) throw new Error('Seleção inválida. Revise os arquivos.');
    const selected = new Set(ids);
    const affected = groups.filter(group => group.files.some(file => selected.has(file.id)));
    if (affected.some(group => group.files.every(file => selected.has(file.id)))) throw new Error('Mantenha pelo menos uma cópia em cada grupo.');
    if (!dryRun && typeof trashItem !== 'function') throw new Error('Envio à Lixeira indisponível.');
    busy = true;
    cancelled = false;
    const out = { dryRun, movedCount: 0, simulatedCount: 0, selectedBytes: 0, results: [], moved: [], simulated: [], skipped: [] };
    const invalidGroups = new Set();
    const moved = new Set();
    const result = (file, status, reason) => {
      const item = { ...publicFile(file), status, ...(reason ? { reason } : {}) };
      out.results.push(item);
      out[status].push(item);
      if (status === 'moved') { moved.add(file.id); out.movedCount++; }
      if (status === 'simulated') out.simulatedCount++;
    };
    try {
      for (const group of affected) {
        const targets = group.files.filter(file => selected.has(file.id));
        out.selectedBytes += targets.reduce((sum, file) => sum + file.bytes, 0);
        const keepers = group.files.filter(file => !selected.has(file.id));
        try {
          // Também revalida a cópia mantida: um resultado antigo não autoriza mover
          // o que pode ter virado a última cópia desde a análise.
          for (const file of group.files) await validateFile(file);
          const keeperHash = await hashFile(keepers[0]);
          if (keeperHash !== await hashFile(targets[0])) throw new Error('O conteúdo do grupo mudou. Faça uma nova busca.');
          for (const target of targets) {
            checkCancelled();
            await validateFile(keepers[0]);
            await validateFile(target);
            if (!(await equalFiles(keepers[0], target))) throw new Error('O conteúdo do grupo mudou. Faça uma nova busca.');
            if (dryRun) result(target, 'simulated');
            else {
              // Última checagem antes da API nativa; jamais usa fs.rm/unlink como alternativa.
              await validateFile(keepers[0]);
              await validateFile(target);
              try { await trashItem(target.path); result(target, 'moved'); }
              catch (error) { result(target, 'skipped', `Não foi possível enviar à Lixeira: ${error.message || 'operação recusada'}`); invalidGroups.add(group.id); }
            }
          }
        } catch (error) {
          invalidGroups.add(group.id);
          for (const target of targets) {
            if (!out.results.some(item => item.id === target.id)) result(target, 'skipped', error.message || 'Arquivo preservado por segurança.');
          }
        }
      }
      // Resultados com alterações precisam de nova análise. Uma simulação mantém
      // as seleções válidas; envios reais retiram somente os itens confirmados.
      updateGroups(groups.filter(group => !invalidGroups.has(group.id)).map(group => ({ ...group, files: group.files.filter(file => !moved.has(file.id)) })));
    } finally { busy = false; }
    out.snapshot = snapshot();
    return out;
  }

  return { roots, addRoot, scan, cancel, snapshot, safeFile, trash };
}

module.exports = { create };
