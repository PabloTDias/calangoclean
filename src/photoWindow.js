// Janela manual de revisão: o painel só recebe IDs; caminhos e operações ficam no main.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { BrowserWindow, ipcMain, dialog, nativeImage, shell, screen, nativeTheme } = require('electron');
const config = require('./config');
const { create: createScanner } = require('./photoDuplicates');

function create({ withMutation = (fn) => fn(), onTrash = () => {}, scannerOptions = {},
  loadConfig = () => config.load(), appendHistory = (record) => config.appendHistory(record),
  appearanceView = () => ({ appearance: 'automatico', colorScheme: nativeTheme?.shouldUseDarkColors ? 'dark' : 'light' }),
  playCompletionSound = async () => ({ok:true,played:false}), demo = false } = {}) {
  let win = null;
  let mutating = false;
  let scanning = null;
  let thumbnails = new Map();
  function currentAppearance() {
    const view = appearanceView();
    return {
      appearance: ['normal', 'noturno', 'automatico'].includes(view?.appearance) ? view.appearance : 'automatico',
      colorScheme: view?.colorScheme === 'dark' ? 'dark' : 'light',
    };
  }
  function updateBackground() {
    if (win && !win.isDestroyed()) win.setBackgroundColor?.(currentAppearance().colorScheme === 'dark' ? '#202320' : '#fafbfa');
  }
  nativeTheme?.on?.('updated', updateBackground);
  const page = pathToFileURL(path.join(__dirname, '..', 'ui', 'photos.html')).href;
  const scanners = new Map(['photos', 'files'].map(mode => [mode, createScanner({
    trashItem: (target) => shell.trashItem(target),
    ...scannerOptions,
    mode,
    onProgress: (progress) => {
      if (win && !win.isDestroyed()) win.webContents.send('photos:progress', { ...progress, mode });
    },
  })]));

  function scannerFor(mode = 'photos') {
    if (!scanners.has(mode)) throw new Error('Escolha Fotos duplicadas ou Arquivos duplicados.');
    return scanners.get(mode);
  }

  function assertSender(event) {
    if (!win || win.isDestroyed() || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) {
      throw new Error('Esta ação só está disponível na janela de fotos e arquivos duplicados.');
    }
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
      assertSender(event);
      return fn(...args);
    });
  }

  handle('photos:task-complete', () => playCompletionSound());

  handle('photos:init', async (mode = 'photos') => {
    const scanner = scannerFor(mode);
    let dryRun = true;
    let error = null;
    try { dryRun = (await loadConfig()).dryRun; } catch (e) { error = e.message; }
    return { mode, roots: scanner.roots(), dryRun, error, demo, ...currentAppearance(), snapshot: scanner.snapshot() };
  });

  handle('photos:add-folder', async (mode = 'photos') => {
    const scanner = scannerFor(mode);
    if (mutating || scanning) return { ok: false, error: 'Aguarde a operação atual.' };
    const result = await dialog.showOpenDialog(win, {
      title: mode === 'photos' ? 'Escolher uma pasta de fotos' : 'Escolher uma pasta de arquivos pessoais', buttonLabel: 'Adicionar pasta',
      properties: ['openDirectory'],
      message: 'Escolha uma pasta pessoal local. Fototecas, aplicativos e pastas sincronizadas ficam de fora.',
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
    try {
      if (mutating || scanning) throw new Error('Aguarde a operação atual.');
      return { ok: true, root: await scanner.addRoot(result.filePaths[0]) };
    }
    catch (e) { return { ok: false, error: e.message }; }
  });

  handle('photos:scan', async (ids, mode = 'photos') => {
    const scanner = scannerFor(mode);
    if (mutating) throw new Error('Aguarde a movimentação dos arquivos.');
    if (scanning) throw new Error('Já existe uma busca de duplicados em andamento.');
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) {
      throw new Error('Escolha pelo menos uma pasta para procurar.');
    }
    thumbnails.clear();
    scanning = mode;
    try { return await scanner.scan(ids); } finally { scanning = null; }
  });
  handle('photos:cancel', (mode = 'photos') => {
    const scanner = scannerFor(mode);
    if (scanning === mode) scanner.cancel();
    return { ok: true };
  });

  handle('photos:thumbnail', async (id, mode = 'photos') => {
    const scanner = scannerFor(mode);
    // Documentos e compactados nunca são abertos para gerar prévias.
    if (mode !== 'photos') return { error: 'Miniaturas estão disponíveis apenas no modo Fotos.' };
    try {
      const file = await scanner.safeFile(id);
      if (thumbnails.has(id)) return { dataUrl: thumbnails.get(id) };
      const image = await nativeImage.createThumbnailFromPath(file.path, { width: 600, height: 420 });
      await scanner.safeFile(id); // Uma miniatura antiga nunca autoriza usar um arquivo alterado.
      if (image.isEmpty()) return { error: 'Prévia indisponível para esta foto.' };
      const dataUrl = `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
      if (thumbnails.size >= 100) thumbnails.delete(thumbnails.keys().next().value);
      thumbnails.set(id, dataUrl);
      return { dataUrl };
    } catch { return { error: 'Não foi possível carregar a prévia. Analise novamente se o arquivo mudou.' }; }
  });

  handle('photos:reveal', async (id, mode = 'photos') => {
    const scanner = scannerFor(mode);
    try {
      const file = await scanner.safeFile(id);
      shell.showItemInFolder(file.path);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  handle('photos:trash', async (confirmation = {}) => {
    const mode = confirmation.mode ?? 'photos';
    const scanner = scannerFor(mode);
    if (mutating) throw new Error('Já existe uma movimentação em andamento.');
    if (scanning) throw new Error('Aguarde a conclusão da busca antes de mover arquivos.');
    mutating = true;
    try {
      return await withMutation(async () => {
        const cfg = await loadConfig(); // Configuração ilegível bloqueia a operação.
        if (confirmation.expectedDryRun !== cfg.dryRun) {
          throw new Error('O modo de limpeza mudou. Revise e confirme novamente.');
        }
        const { scanId, ids } = confirmation;
        const historyId = mode === 'photos' ? 'photoDuplicates' : 'fileDuplicates';
        // Registrar a intenção antes de mover: se o histórico estiver indisponível, aborta.
        await appendHistory({ source: 'ui', id: historyId, mode, dryRun: cfg.dryRun,
          freedBytes: 0, skipped: false, note: 'Revisão de duplicados confirmada.',
          selectedCount: Array.isArray(ids) ? ids.length : 0 });
        const result = await scanner.trash({ scanId, ids, dryRun: cfg.dryRun });
        result.mode = mode;
        const rows = result.results || [];
        result.moved = rows.filter(row => row.status === 'moved');
        result.simulated = rows.filter(row => row.status === 'simulated');
        result.skipped = rows.filter(row => row.status === 'skipped');
        try {
          await appendHistory({ source: 'ui', id: historyId, mode, dryRun: cfg.dryRun,
            freedBytes: 0, skipped: result.moved.length === 0 && result.simulated.length === 0,
            movedCount: result.moved.length, simulatedCount: result.simulated.length,
            results: rows, note: 'Arquivos enviados à Lixeira não contam como espaço liberado.' });
        } catch { result.warning = 'Os arquivos foram processados, mas não foi possível registrar o resultado no histórico.'; }
        thumbnails.clear();
        if (result.moved.length) onTrash();
        return result;
      });
    } finally { mutating = false; }
  });

  handle('photos:open-photos', async () => {
    // Identificador fixo; nenhum comando, argumento ou URL vem do renderer.
    try {
      await new Promise((resolve, reject) => execFile('/usr/bin/open', ['-b', 'com.apple.Photos'],
        { timeout: 10000 }, error => error ? reject(error) : resolve()));
      return { ok: true };
    }
    catch { return { ok: false, error: 'Não foi possível abrir o Fotos. Abra-o pela pasta Aplicativos.' }; }
  });

  async function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1120, area.width - 32);
    const height = Math.min(800, area.height - 32);
    win = new BrowserWindow({
      title: demo ? 'Duplicados — demonstração' : 'Duplicados — CalangoClean',
      width, height, minWidth: Math.min(820, width), minHeight: Math.min(600, height),
      show: false, backgroundColor: currentAppearance().colorScheme === 'dark' ? '#202320' : '#fafbfa', resizable: true, movable: true,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'photosPreload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    // Esconder mantém a revisão e permite voltar do Finder sem perder a seleção.
    win.on('close', event => { event.preventDefault(); win.hide(); });
    win.once('ready-to-show', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
    await win.loadURL(page);
  }

  function destroy() {
    nativeTheme?.removeListener?.('updated', updateBackground);
    for (const scanner of scanners.values()) scanner.cancel();
    thumbnails.clear();
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { open, destroy, scanner: scanners.get('photos'), scanners, getWindow: () => win };
}

module.exports = { create };
