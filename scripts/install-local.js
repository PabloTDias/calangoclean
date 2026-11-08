#!/usr/bin/env node
'use strict';

// Instalação local de desenvolvimento. O aplicativo distribuído continua abrindo
// o DMG no navegador; este script não é um atualizador executado pelo app.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const TARGET = '/Applications/CalangoClean.app';
const BUNDLE_ID = 'com.sejacalango.calangoclean';

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: error?.code || 0, stdout, stderr });
    });
  });
}

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('O aplicativo não informa uma versão válida.');
  }
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Versão fora do intervalo permitido.');
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

function identity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

async function optionalStat(io, target) {
  try { return await io.lstat(target, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directoryChain(io, directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await io.lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Pasta inválida ou link simbólico: ${current}`);
  }
}

async function directory(io, target) {
  await directoryChain(io, path.dirname(target));
  const stat = await io.lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Aplicativo inválido ou link simbólico: ${target}`);
  return stat;
}

// Não segue os symlinks legítimos de frameworks. O snapshot detecta alterações
// concorrentes de caminhos/metadados; não tenta bloquear processos maliciosos
// com a mesma permissão entre duas chamadas ao sistema.
async function snapshot(io, root) {
  const rootStat = await directory(io, root);
  const hash = crypto.createHash('sha256');
  let count = 0;
  async function visit(current, relative) {
    if (++count > 200000) throw new Error('O aplicativo excedeu o limite de arquivos da instalação.');
    const stat = await io.lstat(current, { bigint: true });
    const fields = [relative, stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs];
    // Renomear o bundle pode alterar o ctime da raiz, sem alterar seu conteúdo.
    if (relative) fields.push(stat.ctimeNs);
    hash.update(fields.map(String).join('\0') + '\0');
    if (stat.isSymbolicLink()) hash.update(await io.readlink(current));
    else if (stat.isDirectory()) {
      const names = (await io.readdir(current)).sort();
      for (const name of names) await visit(path.join(current, name), path.join(relative, name));
    } else if (!stat.isFile()) throw new Error(`Arquivo especial não permitido no aplicativo: ${relative}`);
  }
  await visit(root, '');
  const after = await io.lstat(root, { bigint: true });
  if (identity(rootStat) !== identity(after)) throw new Error('O aplicativo mudou durante a verificação.');
  return { identity: identity(after), digest: hash.digest('hex') };
}

function sameSnapshot(a, b) {
  return a?.identity === b?.identity && a?.digest === b?.digest;
}

function createInstaller({ target = TARGET, io = fs, run = runCommand } = {}) {
  target = path.resolve(target);
  if (path.basename(target) !== 'CalangoClean.app') throw new Error('O destino deve se chamar CalangoClean.app.');
  const parent = path.dirname(target);
  const lockPath = path.join(parent, '.CalangoClean-install.lock');

  async function command(program, args, message) {
    const result = await run(program, args);
    if (result.code !== 0) throw new Error(message);
    return result;
  }

  async function inspect(bundle) {
    await directory(io, bundle);
    const contents = path.join(bundle, 'Contents');
    await directory(io, contents);
    const plist = path.join(contents, 'Info.plist');
    const plistStat = await io.lstat(plist, { bigint: true });
    if (plistStat.isSymbolicLink() || !plistStat.isFile()) throw new Error('Info.plist inválido.');
    const result = await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], 'Não foi possível ler os metadados do aplicativo.');
    let info;
    try { info = JSON.parse(result.stdout); } catch { throw new Error('Metadados do aplicativo inválidos.'); }
    if (info.CFBundleIdentifier !== BUNDLE_ID || info.CFBundlePackageType !== 'APPL') {
      throw new Error('O pacote não é um aplicativo CalangoClean válido.');
    }
    versionParts(info.CFBundleShortVersionString);
    const executable = info.CFBundleExecutable;
    if (typeof executable !== 'string' || !executable || /[/\\\0]/.test(executable) || executable === '.' || executable === '..') {
      throw new Error('Executável do aplicativo inválido.');
    }
    const macOS = path.join(contents, 'MacOS');
    await directory(io, macOS);
    const exeStat = await io.lstat(path.join(macOS, executable), { bigint: true });
    if (exeStat.isSymbolicLink() || !exeStat.isFile() || !(exeStat.mode & 0o111n)) throw new Error('Executável do aplicativo inválido.');
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], 'A assinatura do aplicativo não passou na verificação.');
    return { version: info.CFBundleShortVersionString, snapshot: await snapshot(io, bundle) };
  }

  async function requireStopped() {
    const result = await run('/usr/bin/pgrep', ['-x', 'CalangoClean']);
    if (result.code === 0) throw new Error('Feche o CalangoClean antes de instalar a atualização.');
    if (result.code !== 1) throw new Error('Não foi possível verificar se o CalangoClean está fechado.');
  }

  async function install(source) {
    let stage, stageIdentity, lock, lockIdentity, previous, incomingSnapshot, previousMoved = false;
    let newMoved = false, committed = false, preserveStage = false;
    let errorMessage = null;
    const cleanupPending = [];
    let version = null;
    try {
      if (typeof source !== 'string' || !source || source.includes('\0')) throw new Error('Informe o caminho do aplicativo de origem.');
      source = path.resolve(source);
      if (source === target || source.startsWith(target + path.sep) || target.startsWith(source + path.sep)) {
        throw new Error('A origem deve ser um pacote separado do aplicativo instalado.');
      }
      await directoryChain(io, parent);
      try { lock = await io.open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new Error(`Já existe uma instalação em andamento ou um lock pendente: ${lockPath}`);
        throw error;
      }
      lockIdentity = identity(await lock.stat({ bigint: true }));
      await requireStopped();
      const original = await inspect(source);
      version = original.version;
      const existing = await optionalStat(io, target);
      if (existing) {
        previous = await inspect(target);
        if (compareVersions(version, previous.version) < 0) throw new Error('Uma versão mais recente já está instalada; downgrade recusado.');
      }
      stage = await io.mkdtemp(path.join(parent, '.CalangoClean-update-'));
      stageIdentity = identity(await io.lstat(stage, { bigint: true }));
      const incoming = path.join(stage, 'incoming.app');
      const rollback = path.join(stage, 'previous.app');
      await command('/usr/bin/ditto', [source, incoming], 'Não foi possível preparar a atualização.');
      if (!sameSnapshot(original.snapshot, await snapshot(io, source))) throw new Error('A origem mudou durante a cópia; instalação cancelada.');
      const prepared = await inspect(incoming);
      if (prepared.version !== version) throw new Error('A versão copiada é diferente da origem.');
      incomingSnapshot = prepared.snapshot;
      await requireStopped();
      await directoryChain(io, parent);
      const current = await optionalStat(io, target);
      if (previous) {
        if (!current || !sameSnapshot(previous.snapshot, await snapshot(io, target))) throw new Error('O aplicativo instalado mudou; instalação cancelada.');
        await io.rename(target, rollback);
        previousMoved = true;
        if (!sameSnapshot(previous.snapshot, await snapshot(io, rollback))) throw new Error('A versão anterior mudou durante a troca.');
      } else if (current) throw new Error('Outro aplicativo apareceu no destino; instalação cancelada.');
      if (await optionalStat(io, target)) throw new Error('O destino foi ocupado durante a instalação.');
      if (!sameSnapshot(incomingSnapshot, await snapshot(io, incoming))) throw new Error('A atualização preparada mudou; instalação cancelada.');
      await io.rename(incoming, target);
      newMoved = true;
      const installed = await inspect(target);
      if (installed.version !== version || !sameSnapshot(incomingSnapshot, installed.snapshot)) throw new Error('A atualização instalada não corresponde ao pacote validado.');
      committed = true;
    } catch (error) {
      errorMessage = error.message || String(error);
      if (stage && (previousMoved || newMoved)) {
        const rollback = path.join(stage, 'previous.app');
        const failed = path.join(stage, 'failed.app');
        try {
          const current = await optionalStat(io, target);
          if (current) {
            if (!newMoved || !sameSnapshot(incomingSnapshot, await snapshot(io, target))) {
              throw new Error('O destino foi alterado externamente; nenhuma versão foi sobrescrita.');
            }
            await io.rename(target, failed);
            newMoved = false;
          }
          if (previousMoved) {
            if (!sameSnapshot(previous.snapshot, await snapshot(io, rollback))) throw new Error('A cópia de recuperação mudou e foi preservada.');
            if (await optionalStat(io, target)) throw new Error('O destino foi ocupado; a versão anterior foi preservada para recuperação.');
            await io.rename(rollback, target);
            previousMoved = false;
          }
        } catch (recoveryError) {
          preserveStage = true;
          errorMessage += ` ${recoveryError.message} Recuperação pendente em ${stage}.`;
        }
      }
    } finally {
      if (stage) {
        try {
          if (preserveStage) cleanupPending.push(stage);
          else {
            await directoryChain(io, parent);
            const stat = await optionalStat(io, stage);
            if (stat && (stat.isSymbolicLink() || !stat.isDirectory() || identity(stat) !== stageIdentity)) {
              throw new Error('A pasta temporária mudou e foi preservada.');
            }
            if (stat) await io.rm(stage, { recursive: true, force: false });
          }
        } catch { cleanupPending.push(stage); }
      }
      if (lock) {
        try {
          await lock.close();
          const stat = await optionalStat(io, lockPath);
          if (stat && (stat.isSymbolicLink() || identity(stat) !== lockIdentity)) throw new Error('O lock foi alterado.');
          if (stat) await io.unlink(lockPath);
        } catch { cleanupPending.push(lockPath); }
      }
    }
    const status = preserveStage ? 'recovery-required' : committed ? (cleanupPending.length ? 'cleanup-pending' : 'installed') : 'failed';
    return {
      ok: status === 'installed', status, installed: committed, version, previousVersion: previous?.version || null,
      application: target, cleanupPending,
      error: errorMessage || (cleanupPending.length ? 'A nova versão foi instalada e validada, mas a remoção dos temporários ficou pendente.' : null),
    };
  }

  return { install };
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 1) {
    process.stderr.write('Uso: node scripts/install-local.js <origem.app>\n');
    return 1;
  }
  const result = await createInstaller().install(args[0]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { createInstaller, compareVersions, TARGET, BUNDLE_ID };
