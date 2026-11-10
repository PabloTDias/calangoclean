// Atualização dentro do app (sem electron-updater; o app não tem assinatura da Apple).
// Só roda por clique do usuário (IPC `updates:install`). Etapas:
//   1. baixa o DMG da release (só HTTPS, só hosts do GitHub) mostrando o progresso;
//   2. confere tamanho e SHA-256 contra o `digest` publicado na release; se não bater, apaga e cancela;
//   3. monta o DMG (somente leitura, fora do Finder) e valida o app (id, versão, assinatura);
//   4. inicia um script auxiliar desvinculado e encerra o app; o script espera o encerramento, troca o
//      CalangoClean.app (ditto → staging → renomeia), ejeta o disco, apaga o DMG e reabre o app.
// Qualquer falha antes da troca deixa a versão instalada intacta; falha durante a troca desfaz a troca.
// Nada aqui usa sudo e nenhum caminho vem do painel.
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const updates = require('./updates');

const WORK_PREFIX = 'calangoclean-update-';
const APP_NAME = 'CalangoClean.app';
const APP_ID = 'com.sejacalango.calangoclean';
const RESULT_FILE = 'update-result.json';
const MAX_REDIRECTS = 5;
const IDLE_TIMEOUT = 30000;

class UpdateError extends Error {}
const fail = (message) => new UpdateError(message);

const hostAllowed = (host) => host === 'github.com' || host.endsWith('.githubusercontent.com');

function run(cmd, args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } },
      (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
  });
}

// Baixa `url` para `dest` calculando o SHA-256 durante o download. Segue redirecionamentos só dentro do GitHub.
function download(url, dest, { expectedSize, onProgress = () => {}, request = https.get, signal, hops = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(url); } catch { return reject(fail('Endereço de download inválido.')); }
    if (target.protocol !== 'https:' || target.username || target.password || !hostAllowed(target.hostname)) {
      return reject(fail('O download aponta para um endereço não permitido.'));
    }
    if (signal?.aborted) return reject(fail('Atualização cancelada.'));
    const req = request(target, { headers: { 'User-Agent': 'CalangoClean', Accept: 'application/octet-stream' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (hops >= MAX_REDIRECTS || !res.headers.location) return reject(fail('O download foi redirecionado demais vezes.'));
        let next;
        try { next = new URL(res.headers.location, target).href; } catch { return reject(fail('Redirecionamento de download inválido.')); }
        return resolve(download(next, dest, { expectedSize, onProgress, request, signal, hops: hops + 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(fail(`O GitHub recusou o download (código ${res.statusCode}).`));
      }
      const total = expectedSize || Number(res.headers['content-length']) || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (expectedSize && received > expectedSize) return req.destroy(fail('O arquivo baixado é maior que o publicado.'));
        hash.update(chunk);
        onProgress({ received, total });
      });
      res.on('error', (e) => { out.destroy(); reject(e); });
      out.on('error', reject);
      out.on('finish', () => resolve({ sha256: hash.digest('hex'), bytes: received }));
      res.pipe(out);
    });
    req.setTimeout(IDLE_TIMEOUT, () => req.destroy(fail('O download parou de responder.')));
    req.on('error', reject);
    signal?.addEventListener('abort', () => req.destroy(fail('Atualização cancelada.')), { once: true });
  });
}

// O app só se atualiza de onde está instalado (normalmente /Applications), nunca de um DMG ou da quarentena do macOS.
async function checkInstallLocation(appBundle) {
  if (process.platform !== 'darwin') throw fail('A atualização automática só existe no macOS.');
  if (!appBundle || path.basename(appBundle) !== APP_NAME) {
    throw fail('A atualização automática só funciona com o CalangoClean instalado (CalangoClean.app).');
  }
  if (appBundle.includes('/AppTranslocation/') || appBundle.startsWith('/Volumes/')) {
    throw fail('Mova o CalangoClean para a pasta Aplicativos antes de atualizar.');
  }
  const stat = await fsp.lstat(appBundle).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw fail('Não encontrei o CalangoClean instalado para atualizar.');
  try { await fsp.access(path.dirname(appBundle), fs.constants.W_OK); }
  catch { throw fail(`Sem permissão para escrever em ${path.dirname(appBundle)}. A versão atual foi mantida.`); }
}

async function plistValue(plist, key, runner = run) {
  return (await runner('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])).stdout.trim();
}

// Confere o app dentro do DMG montado antes de encerrar o app atual.
async function validateMountedApp(mount, version, runner = run) {
  const app = path.join(mount, APP_NAME);
  const stat = await fsp.lstat(app).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw fail('O instalador não contém o CalangoClean.app esperado.');
  const plist = path.join(app, 'Contents', 'Info.plist');
  let id, ver;
  try { [id, ver] = [await plistValue(plist, 'CFBundleIdentifier', runner), await plistValue(plist, 'CFBundleShortVersionString', runner)]; }
  catch { throw fail('Não consegui ler a identidade do app no instalador.'); }
  if (id !== APP_ID) throw fail('O instalador não é do CalangoClean.');
  if (ver !== version) throw fail(`A versão dentro do instalador (${ver}) não é a anunciada (${version}).`);
  try { await runner('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 120000 }); }
  catch { throw fail('A assinatura do app no instalador está inválida.'); }
  return app;
}

// Script auxiliar. Recebe tudo por argumentos (nada é interpolado no texto) e roda depois que o app fecha.
const HELPER = `#!/bin/bash
PID="$1"; SRC="$2"; DEST="$3"; WORK="$4"; MNT="$5"; HIST="$6"; RES="$7"; FROM="$8"; TO="$9"
PATH=/usr/bin:/bin:/usr/sbin:/sbin
PARENT="$(dirname "$DEST")"; STAGE="$PARENT/.CalangoClean.new.$$"; OLD="$PARENT/.CalangoClean.old.$$"
now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
hist() { printf '%s | update | appUpdate | real | freed=0 | %s | %s\\n' "$(now)" "$1" "$2" >> "$HIST"; }
result() { printf '{"ok":%s,"from":"%s","to":"%s","error":"%s","at":"%s"}\\n' "$1" "$FROM" "$TO" "$2" "$(now)" > "$RES"; }
cleanup() {
  hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || hdiutil detach "$MNT" -force -quiet >/dev/null 2>&1
  case "$WORK" in */calangoclean-update-*) rm -rf "$WORK" ;; esac
  rm -rf "$STAGE"
}
bail() {
  hist "failed ($1)" "Atualização para $TO não concluída; versão $FROM mantida"
  result false "$1"
  cleanup
  [ -d "$DEST" ] && open "$DEST"
  exit 1
}
for i in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then
  hist "failed (o app não encerrou a tempo)" "Atualização para $TO cancelada; nada foi alterado"
  result false "O CalangoClean não encerrou a tempo. Nada foi alterado."
  cleanup; exit 1
fi
hist ok "App encerrado; substituindo $FROM por $TO"
ditto "$SRC" "$STAGE" || bail "Falha ao copiar a nova versão"
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null
NEWVER="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$STAGE/Contents/Info.plist" 2>/dev/null)"
[ "$NEWVER" = "$TO" ] || bail "A cópia não confere com a versão esperada"
codesign --verify --deep --strict "$STAGE" >/dev/null 2>&1 || bail "A cópia não passou na verificação de assinatura"
mv "$DEST" "$OLD" || bail "Não foi possível substituir o app instalado"
if ! mv "$STAGE" "$DEST"; then
  mv "$OLD" "$DEST"
  bail "Falha ao instalar a nova versão; a anterior foi restaurada"
fi
rm -rf "$OLD"
hist ok "CalangoClean $TO instalado (antes: $FROM); instalador removido"
result true ""
cleanup
open "$DEST"
`;

function defaultSpawn(script, args) {
  const { spawn } = require('node:child_process');
  const child = spawn('/bin/bash', [script, ...args], { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
  child.unref();
}

// Orquestra o fluxo completo. Dependências injetáveis para teste.
function create({ appBundle, version, pid = process.pid, appDir, historyFile, log = async () => {}, mutations,
  quit = () => {}, workRoot = os.tmpdir(), runner = run, request = https.get, spawnHelper = defaultSpawn } = {}) {
  let running = false;
  let controller = null;
  const resultFile = path.join(appDir, RESULT_FILE);

  async function install(available, onProgress = () => {}) {
    if (running) throw fail('Já existe uma atualização em andamento.');
    running = true;
    controller = new AbortController();
    let work = null, mount = null, mounted = false;
    const step = async (note, status) => { await log({ note, status }).catch(() => {}); };
    try {
      if (!available || !updates.newer(available.version, version) || !/^[0-9a-f]{64}$/.test(available.sha256 || '') ||
        !updates.downloadUrl(available.url) || !Number.isSafeInteger(available.size) || available.size <= 0) {
        throw fail('Nenhuma atualização válida disponível.');
      }
      await checkInstallLocation(appBundle);
      await step(`Atualização ${version} -> ${available.version} solicitada pelo usuário`);
      work = await fsp.mkdtemp(path.join(workRoot, WORK_PREFIX));
      await fsp.chmod(work, 0o700);
      const dmg = path.join(work, 'CalangoClean.dmg');
      mount = path.join(work, 'volume');

      onProgress({ phase: 'download', percent: 0 });
      let last = -1;
      const { sha256, bytes } = await download(available.url, dmg, {
        expectedSize: available.size, request, signal: controller.signal,
        onProgress: ({ received, total }) => {
          const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
          if (percent !== last) { last = percent; onProgress({ phase: 'download', percent, received, total }); }
        },
      });
      onProgress({ phase: 'verify', percent: 100 });
      if (bytes !== available.size) throw fail('O arquivo baixado está incompleto.');
      if (sha256 !== available.sha256) {
        await step(`SHA-256 não confere (esperado ${available.sha256}, obtido ${sha256}); atualização cancelada`, 'failed');
        throw fail('A verificação de segurança (SHA-256) falhou. O arquivo baixado foi descartado e nada foi instalado.');
      }
      await step(`Download concluído; SHA-256 conferido (${sha256.slice(0, 12)}…)`);

      onProgress({ phase: 'mount', percent: 100 });
      await fsp.mkdir(mount, { mode: 0o700 });
      try {
        await runner('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mount, dmg], { timeout: 120000 });
        mounted = true;
      } catch { throw fail('Não consegui abrir o instalador baixado.'); }
      const source = await validateMountedApp(mount, available.version, runner);
      await step(`Instalador montado e validado (CalangoClean ${available.version})`);

      onProgress({ phase: 'restart', percent: 100 });
      const helper = path.join(work, 'install-update.sh');
      await fsp.writeFile(helper, HELPER, { mode: 0o700 });
      if (mutations.isBusy()) throw fail('Há uma limpeza em andamento. Aguarde terminar e tente atualizar de novo.');
      await mutations.run(async () => {
        await step('Reiniciando o app para concluir a atualização');
        spawnHelper(helper, [String(pid), source, appBundle, work, mount, historyFile, resultFile, version, available.version]);
        quit();
      });
      return { ok: true };
    } catch (error) {
      if (mounted) await runner('/usr/bin/hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => {});
      if (work && path.basename(work).startsWith(WORK_PREFIX)) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      const message = error instanceof UpdateError ? error.message
        : error?.code === 'ENOSPC' ? 'Sem espaço em disco para baixar a atualização.'
          : 'Não foi possível concluir a atualização. A versão atual foi mantida.';
      await step(`Atualização para ${available?.version || '?'} falhou: ${message}`, 'failed');
      return { ok: false, error: message };
    } finally {
      running = false;
      controller = null;
    }
  }

  // Lê (e apaga) o resultado deixado pelo script auxiliar na abertura seguinte.
  async function takeResult() {
    try {
      const raw = JSON.parse(await fsp.readFile(resultFile, 'utf8'));
      await fsp.rm(resultFile, { force: true });
      if (typeof raw?.ok !== 'boolean') return null;
      return { ok: raw.ok, from: String(raw.from || ''), to: String(raw.to || ''), error: String(raw.error || '') };
    } catch { return null; }
  }

  return { install, takeResult, cancel: () => controller?.abort(), isRunning: () => running };
}

module.exports = { create, download, checkInstallLocation, validateMountedApp, HELPER, WORK_PREFIX, RESULT_FILE };
