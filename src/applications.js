// Desinstalação explícita de bundles .app. Nunca procura nem remove dados em Library.
// O processo principal injeta shell.trashItem; este módulo não conhece o renderer.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readLastUsed: defaultReadLastUsed } = require('./appUsage');

const runFile = promisify(execFile);
const SELF_ID = 'com.sejacalango.calangoclean';
const DATA_NOTICE = 'Somente o aplicativo será movido à Lixeira. Documentos, preferências e outros dados serão mantidos. O espaço só será liberado ao esvaziar a Lixeira.';

function failure(code, error) { return { ok: false, code, error }; }
function problem(code, message) { return Object.assign(new Error(message), { code }); }
function within(candidate, parent) { return candidate === parent || candidate.startsWith(`${parent}${path.sep}`); }
function systemPath(candidate) {
  return ['/System', '/Library/Apple', '/System/Volumes/Data/System'].some(root => within(candidate, root));
}
function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}
function ownBundle(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) return null;
  const match = path.resolve(input).match(/^(.*?\.app)(?:\/|$)/i);
  return match ? match[1] : path.resolve(input);
}
async function defaultReadPlist(file) {
  const { stdout } = await runFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], {
    timeout: 15000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}
async function defaultListProcesses() {
  const { stdout } = await runFile('/bin/ps', ['-ax', '-o', 'comm=', '-ww'], {
    timeout: 10000, maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

function create(options = {}) {
  const roots = [...new Set((options.roots || ['/Applications', path.join(os.homedir(), 'Applications')])
    .filter(root => typeof root === 'string' && path.isAbsolute(root)).map(root => path.resolve(root)))];
  const readOnlyRoots = [...new Set((options.readOnlyRoots || (options.roots ? [] : ['/System/Applications']))
    .filter(root => typeof root === 'string' && path.isAbsolute(root)).map(root => path.resolve(root)))];
  const readLastUsed = options.readLastUsed || defaultReadLastUsed;
  const selfPath = ownBundle(options.selfPath);
  const readPlist = options.readPlist || defaultReadPlist;
  const listProcesses = options.listProcesses || defaultListProcesses;
  const now = options.now || Date.now;
  const ttl = options.tokenTtlMs ?? 5 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 150000;
  const maxScanMs = options.maxScanMs ?? 60000;
  let entries = new Map();
  const tokens = new Map();
  let listing = null;
  let busy = false;

  async function rootState(root, allowSystem = false) {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('UNSAFE_ROOT', 'A pasta de aplicativos é um atalho ou não é uma pasta válida.');
    const real = await fs.realpath(root);
    if (!allowSystem && (systemPath(root) || systemPath(real))) throw problem('PROTECTED', 'Aplicativos do sistema são protegidos.');
    return { real, identity: identity(stat), dev: stat.dev, ino: stat.ino };
  }

  async function locate(entry, expectedRoot, allowReadOnly = false) {
    if (entry.readOnly && !allowReadOnly) throw problem('PROTECTED', 'Aplicativo do macOS. A remoção não está disponível.');
    const basePath = entry.baseRoot || entry.root;
    if (!(entry.readOnly ? readOnlyRoots : roots).includes(basePath)) throw problem('UNSAFE_PATH', 'Aplicativo fora das pastas permitidas.');
    const base = await rootState(basePath, entry.readOnly && allowReadOnly);
    const root = await rootState(entry.root, entry.readOnly && allowReadOnly);
    if (!within(root.real, base.real) || root.real !== path.resolve(base.real, path.relative(basePath, entry.root))) {
      throw problem('UNSAFE_PATH', 'A pasta do aplicativo mudou ou contém um atalho.');
    }
    if (expectedRoot && (root.real !== expectedRoot.real || root.dev !== expectedRoot.dev || root.ino !== expectedRoot.ino)) {
      throw problem('CHANGED', 'A pasta de aplicativos mudou. Atualize a lista e revise novamente.');
    }
    if (path.dirname(entry.path) !== entry.root || !entry.path.endsWith('.app') || /[\x00-\x1f\x7f]/.test(entry.path)) {
      throw problem('UNSAFE_PATH', 'O caminho deste aplicativo não pode ser validado com segurança. Use o Finder.');
    }
    const stat = await fs.lstat(entry.path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('UNSAFE_BUNDLE', 'Atalhos e bundles inválidos não podem ser desinstalados.');
    const real = await fs.realpath(entry.path);
    if (path.dirname(real) !== root.real || (!allowReadOnly && systemPath(real))) throw problem('UNSAFE_PATH', 'Aplicativo fora das pastas permitidas.');
    return { root, stat, real };
  }

  async function inspect(entry, expectedRoot, allowReadOnly = false) {
    const location = await locate(entry, expectedRoot, allowReadOnly);
    const contents = path.join(entry.path, 'Contents');
    const macos = path.join(contents, 'MacOS');
    for (const directory of [contents, macos]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('INVALID_BUNDLE', 'A estrutura do aplicativo é inválida. Use o Finder para revisar.');
    }
    const plistPath = path.join(contents, 'Info.plist');
    const plistBefore = await fs.lstat(plistPath);
    if (!plistBefore.isFile() || plistBefore.isSymbolicLink() || plistBefore.nlink !== 1 || plistBefore.size > 1024 * 1024) {
      throw problem('INVALID_BUNDLE', 'Os metadados do aplicativo não puderam ser validados.');
    }
    const metadata = await readPlist(plistPath);
    const plistAfter = await fs.lstat(plistPath);
    if (identity(plistBefore) !== identity(plistAfter)) throw problem('CHANGED', 'O aplicativo mudou durante a leitura. Revise novamente.');
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object'
      || typeof metadata.CFBundleIdentifier !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(metadata.CFBundleIdentifier)
      || typeof metadata.CFBundleExecutable !== 'string'
      || !metadata.CFBundleExecutable || metadata.CFBundleExecutable === '.' || metadata.CFBundleExecutable === '..'
      || metadata.CFBundleExecutable.includes('/') || metadata.CFBundleExecutable.includes('\0')
      || (metadata.CFBundlePackageType && metadata.CFBundlePackageType !== 'APPL')) {
      throw problem('INVALID_BUNDLE', 'Os metadados do aplicativo não puderam ser validados.');
    }
    const executable = await fs.lstat(path.join(macos, metadata.CFBundleExecutable));
    if (!executable.isFile() || executable.isSymbolicLink()) throw problem('INVALID_BUNDLE', 'O executável do aplicativo é inválido.');
    const rawName = metadata.CFBundleDisplayName || metadata.CFBundleName;
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 180) : path.basename(entry.path, '.app');
    const rawVersion = metadata.CFBundleShortVersionString || metadata.CFBundleVersion;
    const version = typeof rawVersion === 'string' || typeof rawVersion === 'number' ? String(rawVersion).slice(0, 80) : '';
    const result = { ...location, name, version, bundleId: metadata.CFBundleIdentifier, plistIdentity: identity(plistAfter), protected: false, reason: '' };
    if (entry.readOnly || result.bundleId.startsWith('com.apple.')) {
      result.protected = true;
      result.reason = 'Aplicativo da Apple protegido. Use as opções do macOS para gerenciá-lo.';
    } else if (result.bundleId === SELF_ID || /^calangoclean\.app$/i.test(path.basename(entry.path))
      || (selfPath && (entry.path === selfPath || result.real === selfPath))) {
      result.protected = true;
      result.reason = 'O CalangoClean não pode desinstalar a si próprio.';
    } else if (metadata.SMPrivilegedExecutables || /(?:uninstall|desinstal)/i.test(path.basename(entry.path))) {
      result.protected = true;
      result.reason = 'Este aplicativo precisa do desinstalador do fabricante para remover seus componentes.';
    }
    const after = await locate(entry, result.root, allowReadOnly);
    if (identity(location.stat) !== identity(after.stat)) throw problem('CHANGED', 'O aplicativo mudou durante a leitura. Revise novamente.');
    return result;
  }

  async function runningFor(entry, snapshot, processPaths) {
    if (options.isRunning) {
      const result = await options.isRunning(snapshot.real, snapshot.bundleId);
      if (typeof result !== 'boolean') throw problem('PROCESS_UNAVAILABLE', 'Não foi possível verificar os aplicativos abertos. Tente novamente.');
      return result;
    }
    let processes = processPaths;
    if (!processes) {
      try { processes = await listProcesses(); }
      catch { throw problem('PROCESS_UNAVAILABLE', 'Não foi possível verificar os aplicativos abertos. Tente novamente.'); }
    }
    if (!Array.isArray(processes) || processes.some(item => typeof item !== 'string')) {
      throw problem('PROCESS_UNAVAILABLE', 'Não foi possível verificar os aplicativos abertos. Tente novamente.');
    }
    return processes.some(executable => within(executable, entry.path) || within(executable, snapshot.real));
  }

  function publicEntry(entry) {
    return { id: entry.id, name: entry.name, version: entry.version || '', bytes: entry.bytes ?? null, icon: entry.icon || null, lastUsedAt: entry.lastUsedAt || null,
      canUninstall: !entry.protected && !entry.running && !entry.unavailable, protected: !!entry.protected,
      running: !!entry.running, reason: entry.reason || '' };
  }

  function asFailure(error) {
    const code = error?.code;
    const messages = {
      ENOENT: 'O aplicativo não está mais disponível. Atualize a lista.',
      EACCES: 'Sem permissão para acessar este aplicativo. Use o Finder ou o desinstalador do fabricante.',
      EPERM: 'O macOS não permitiu a operação. Use o Finder ou o desinstalador do fabricante.',
    };
    if (messages[code]) return failure(code, messages[code]);
    if (['UNSAFE_ROOT', 'PROTECTED', 'CHANGED', 'UNSAFE_PATH', 'UNSAFE_BUNDLE', 'INVALID_BUNDLE', 'PROCESS_UNAVAILABLE', 'TOO_LARGE', 'RUNNING'].includes(code)) {
      return failure(code, error.message);
    }
    return failure('UNAVAILABLE', 'Não foi possível revisar este aplicativo com segurança. Use o Finder ou tente novamente.');
  }

  async function list() {
    if (busy) return failure('BUSY', 'Uma desinstalação já está em andamento.');
    if (listing) return listing;
    listing = (async () => {
      const next = new Map();
      const errors = [];
      let processPaths;
      let processError = false;
      if (!options.isRunning) {
        try {
          processPaths = await listProcesses();
          if (!Array.isArray(processPaths) || processPaths.some(item => typeof item !== 'string')) throw new Error('invalid processes');
        } catch { processError = true; }
      }
      const discovered = [];
      let visited = 0;
      async function discover(baseRoot, root, readOnly, depth = 0) {
        if (depth > 4 || ++visited > 1000) { errors.push('Algumas subpastas não puderam ser listadas.'); return; }
        try {
          const base = await rootState(baseRoot, readOnly);
          const current = await rootState(root, readOnly);
          if (current.real !== path.resolve(base.real, path.relative(baseRoot, root))) return;
          const names = await fs.readdir(root, { withFileTypes: true });
          for (const item of names.sort((a,b) => a.name.localeCompare(b.name))) {
            if (item.name.startsWith('.')) continue;
            const target = path.join(root, item.name);
            if (item.name.endsWith('.app')) {
              discovered.push({ id: crypto.randomUUID(), baseRoot, root, readOnly, path: target, name: item.name.slice(0,-4), bytes: null });
            } else if (item.isDirectory() && !/\.(?:framework|bundle|plugin|xpc|appex|photoslibrary)$/i.test(item.name)) await discover(baseRoot, target, readOnly, depth + 1);
          }
        } catch (error) { if (error.code !== 'ENOENT') errors.push(asFailure(error).error); }
      }
      for (const root of roots) await discover(root, root, false);
      for (const root of readOnlyRoots.filter(root => !roots.includes(root))) await discover(root, root, true);
      for (const entry of discovered) {
          try {
            const snapshot = await inspect(entry, undefined, entry.readOnly);
            Object.assign(entry, { name: snapshot.name, version: snapshot.version, protected: snapshot.protected, reason: snapshot.reason, rootState: snapshot.root });
            try { entry.lastUsedAt = await readLastUsed(snapshot.real); } catch { entry.lastUsedAt = null; }
            if (options.getIcon) {
              try { entry.icon = await options.getIcon(snapshot.real); } catch { entry.icon = null; }
            }
            if (processError) throw problem('PROCESS_UNAVAILABLE', 'Não foi possível verificar os aplicativos abertos. Tente novamente.');
            entry.running = await runningFor(entry, snapshot, processPaths);
            if (entry.running && !entry.protected) entry.reason = 'Feche o aplicativo antes de desinstalar.';
          } catch (error) {
            entry.unavailable = true;
            entry.reason = asFailure(error).error;
          }
          next.set(entry.id, entry);
      }
      entries = next;
      tokens.clear();
      return { ok: true, items: [...entries.values()].map(publicEntry).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), errors: [...new Set(errors)] };
    })().finally(() => { listing = null; });
    return listing;
  }

  // Hash da árvore inclui identidade de cada entrada. Links são registrados, nunca percorridos.
  async function measure(entry, snapshot) {
    const hash = crypto.createHash('sha256');
    const seenFiles = new Set();
    const started = Date.now();
    let bytes = 0;
    let count = 0;
    let needsVendor = false;
    async function visit(file, relative, depth) {
      if (++count > maxEntries || depth > 80 || Date.now() - started > maxScanMs) {
        throw problem('TOO_LARGE', 'Este aplicativo é grande demais para uma revisão segura aqui. Use o Finder ou o desinstalador do fabricante.');
      }
      const before = await fs.lstat(file);
      hash.update(`${JSON.stringify(relative)}:${identity(before)}\n`);
      if (before.isSymbolicLink()) return;
      if (/\.(?:kext|systemextension)$/i.test(relative)) needsVendor = true;
      if (before.isFile()) {
        const fileId = `${before.dev}:${before.ino}`;
        if (!seenFiles.has(fileId)) { seenFiles.add(fileId); bytes += before.size; }
      } else if (before.isDirectory()) {
        const expectedReal = path.join(snapshot.real, relative);
        if (await fs.realpath(file) !== expectedReal) throw problem('CHANGED', 'O aplicativo mudou durante a leitura. Revise novamente.');
        for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name), path.join(relative, name), depth + 1);
      } else {
        throw problem('INVALID_BUNDLE', 'Este aplicativo contém arquivos especiais. Use o desinstalador do fabricante.');
      }
      if (identity(before) !== identity(await fs.lstat(file))) throw problem('CHANGED', 'O aplicativo mudou durante a leitura. Revise novamente.');
    }
    await visit(entry.path, '', 0);
    if (needsVendor) throw problem('PROTECTED', 'Este aplicativo instala extensões do sistema. Use o desinstalador do fabricante.');
    const after = await locate(entry, snapshot.root);
    if (identity(after.stat) !== identity(snapshot.stat)
      || identity(await fs.lstat(path.join(entry.path, 'Contents', 'Info.plist'))) !== snapshot.plistIdentity) {
      throw problem('CHANGED', 'O aplicativo mudou durante a leitura. Revise novamente.');
    }
    return { bytes, signature: `${snapshot.root.real}:${snapshot.root.identity}:${snapshot.real}:${identity(after.stat)}:${snapshot.bundleId}:${hash.digest('hex')}` };
  }

  async function review(entry) {
    const snapshot = await inspect(entry, entry.rootState);
    if (snapshot.protected) throw problem('PROTECTED', snapshot.reason);
    if (await runningFor(entry, snapshot)) throw problem('RUNNING', 'Feche o aplicativo antes de desinstalar. Ele não será encerrado automaticamente.');
    const measured = await measure(entry, snapshot);
    return { snapshot, ...measured };
  }

  async function prepare(id) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    const entry = typeof id === 'string' ? entries.get(id) : null;
    if (!entry) return failure('UNKNOWN_APP', 'Aplicativo não encontrado. Atualize a lista.');
    try {
      const reviewed = await review(entry);
      for (const [token, value] of tokens) if (value.id === id || value.expiresAt <= now()) tokens.delete(token);
      const token = crypto.randomBytes(32).toString('hex');
      tokens.set(token, { id, signature: reviewed.signature, expiresAt: now() + ttl });
      entry.bytes = reviewed.bytes;
      return { ok: true, id, token, name: reviewed.snapshot.name, version: reviewed.snapshot.version, bytes: reviewed.bytes, details: DATA_NOTICE };
    } catch (error) { return asFailure(error); }
  }

  async function uninstall(request, config = {}) {
    if (busy || listing) return failure('BUSY', 'Aguarde a operação em andamento.');
    const confirmation = request && typeof request.token === 'string' ? tokens.get(request.token) : null;
    // Toda tentativa consome a confirmação, inclusive se o modo ou o aplicativo mudou.
    if (request && typeof request.token === 'string') tokens.delete(request.token);
    if (!confirmation || confirmation.id !== request.id || confirmation.expiresAt <= now()) {
      return failure('INVALID_CONFIRMATION', 'A confirmação expirou ou já foi usada. Revise o aplicativo novamente.');
    }
    if (typeof config.dryRun !== 'boolean' || typeof request.expectedDryRun !== 'boolean' || config.dryRun !== request.expectedDryRun) {
      return failure('MODE_CHANGED', 'O modo de simulação mudou. Revise o aplicativo novamente.');
    }
    const entry = entries.get(request.id);
    if (!entry) return failure('UNKNOWN_APP', 'Aplicativo não encontrado. Atualize a lista.');
    busy = true;
    try {
      const reviewed = await review(entry);
      if (reviewed.signature !== confirmation.signature) return failure('CHANGED', 'O aplicativo mudou desde a confirmação. Revise novamente.');
      // Revalida o processo e a identidade logo antes da única operação que altera o disco.
      if (await runningFor(entry, reviewed.snapshot)) return failure('RUNNING', 'Feche o aplicativo antes de desinstalar. Ele não será encerrado automaticamente.');
      const final = await locate(entry, reviewed.snapshot.root);
      if (identity(final.stat) !== identity(reviewed.snapshot.stat)) return failure('CHANGED', 'O aplicativo mudou desde a confirmação. Revise novamente.');
      if (!config.dryRun) {
        if (typeof options.trashItem !== 'function') return failure('TRASH_UNAVAILABLE', 'A Lixeira do macOS não está disponível.');
        try { await options.trashItem(entry.path); }
        catch (error) {
          if (['EACCES', 'EPERM'].includes(error?.code)) return asFailure(error);
          return failure('TRASH_FAILED', 'Não foi possível mover o aplicativo à Lixeira. Nenhum dado adicional foi removido. Use o Finder ou tente novamente.');
        }
        entries.delete(entry.id);
      }
      return { ok: true, id: entry.id, name: reviewed.snapshot.name, bytes: reviewed.bytes,
        dryRun: config.dryRun, movedToTrash: !config.dryRun, details: DATA_NOTICE };
    } catch (error) { return asFailure(error); }
    finally { busy = false; }
  }

  async function pathFor(id) {
    const entry = typeof id === 'string' ? entries.get(id) : null;
    if (!entry) return null;
    try { await locate(entry, entry.rootState, !!entry.readOnly); return entry.path; } catch { return null; }
  }

  return { list, prepare, uninstall, pathFor };
}

module.exports = { create };
