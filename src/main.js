const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, Notification } = require('electron');
const { menubar } = require('menubar');
const config = require('./config');
const disk = require('./disk');
const categories = require('./categories');
const browsers = require('./browsers');
const cleaner = require('./cleaner').create({ categories, browsers });
const scheduler = require('./scheduler');
const volumes = require('./volumes');
const volumeFolders = require('./volumeFolders').create({ listVolumes: () => volumes.list() });
const network = require('./network');
const bluetooth = require('./bluetooth');
const folders = require('./folders');
const migrate = require('./migrate');
const updates = require('./updates');
const photoWindow = require('./photoWindow');
const appearance = require('./appearance');
const applications = require('./applications');
const performance = require('./performance');
const appIcons = require('./appIcons');
const completionSound = require('./completionSound');
const privacy = require('./privacy');
const updateChecker = updates.create({ version: app.getVersion() });
const updateInstaller = require('./updateInstaller');
const notifiedVersions = new Set();
let photos = null;
const mutations = require('./mutationGate').create();
// Só existe app instalado (CalangoClean.app) quando empacotado; em desenvolvimento a atualização é recusada.
const installer = updateInstaller.create({
  appBundle: app.isPackaged ? path.resolve(app.getPath('exe'), '..', '..', '..') : null,
  version: app.getVersion(),
  appDir: config.APP_DIR,
  historyFile: config.HISTORY_FILE,
  mutations,
  log: ({ note, status }) => config.appendHistory({ source: 'update', id: 'appUpdate', dryRun: false, freedBytes: 0,
    skipped: false, status, reason: status === 'failed' ? 'atualização' : undefined, note }),
  quit: () => { app.quit(); setTimeout(() => app.exit(0), 5000); },
});
let lastUpdateResult = null;

// A Lixeira comum e a revisão de fotos não podem modificar arquivos ao mesmo tempo.
const withMutation = (fn, options) => mutations.run(fn, options);

async function checkUpdates(force = false) {
  const state = await updateChecker.check({ force });
  if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('updates:changed', state);
  if (state.available && !notifiedVersions.has(state.available.version) && Notification.isSupported()) {
    notifiedVersions.add(state.available.version);
    const notice = new Notification({
      title: 'CalangoClean — atualização disponível',
      body: `A versão ${state.available.version} já pode ser baixada. Clique para ver no painel.`,
    });
    notice.on('click', () => mb.showWindow().catch(() => {}));
    notice.show();
  }
  return state;
}

const WIN_W = 420;
const WIN_H = 660;
const SITE_URL = 'https://sejacalango.com.br';
const PANEL_URL = pathToFileURL(path.join(__dirname, '..', 'ui', 'index.html')).href;

// Em desenvolvimento a janela abre sozinha e fica fixa (não some ao perder o foco),
// para dar para trabalhar mesmo se o ícone estiver escondido na barra de menu.
const isDev = !app.isPackaged;

const appearanceController = appearance.create({
  nativeTheme,
  config,
  onChanged: (state) => {
    if (!app.isReady()) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('appearance:changed', state);
    }
  },
});

const mb = menubar({
  index: PANEL_URL,
  // Template image: o Electron usa iconTemplate@2x.png em telas Retina e pinta conforme o tema.
  icon: path.join(__dirname, '..', 'assets', 'iconTemplate.png'),
  tooltip: 'CalangoClean',
  windowPosition: 'trayCenter',
  browserWindow: {
    icon: path.join(__dirname, '..', 'ui', 'app-icon.png'),
    width: WIN_W,
    height: WIN_H,
    resizable: false,
    movable: false,
    fullscreenable: false,
    alwaysOnTop: isDev,
    transparent: true,
    hasShadow: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  },
});

function updateTrayTitle(free) {
  const gb = Math.round(free / 1e9); // base 10, igual ao Finder
  mb.tray.setTitle(` ${gb} GB`, { fontType: 'monospacedDigit' });
}

async function analyze(id) {
  const mutationRevision = mutations.revision();
  const cat = categories.get(id);
  if (!cat) throw new Error('Categoria desconhecida.');
  const found = await cat.detect();
  if (!found) return { id, mutationRevision, found: false, bytes: 0, blockedReason: null, accessIssue: null, details: [] };
  const [bytes, blockedReason, accessIssue, details, note, canOpen, tip, settings] = await Promise.all([
    cat.measure(),
    cat.blockedReason(),
    cat.accessIssue(),
    cat.details(),
    cat.note ? cat.note() : null, // texto dinâmico opcional para a descrição do card
    cat.canOpen ? cat.canOpen() : undefined, // categorias com botão "Abrir app": o app está instalado?
    cat.tip ? cat.tip() : null, // texto extra do tooltip (ex.: regra do prazo da Lixeira)
    cat.settings ? cat.settings() : null, // configuração mostrada no card (ex.: prazo da Lixeira)
  ]);
  return { id, mutationRevision, found, bytes, blockedReason, accessIssue, details, note, canOpen, tip, settings };
}

// Visão do agendamento para o painel: config + estado real no launchd.
async function scheduleView(extra = {}) {
  const { cfg, error } = await config.loadSafe();
  if (error && !extra.error) extra = { ...extra, error: `${error} O agendamento não foi alterado.` };
  const st = await scheduler.status();
  return {
    ...cfg.schedule,
    loaded: st.loaded,
    last: cfg.lastRun,
    dryRun: cfg.dryRun,
    ...extra,
  };
}

function registerIpc() {
  const assertPanelSender = (event) => {
    if (!mb.window || mb.window.isDestroyed() || event.sender !== mb.window.webContents ||
        event.senderFrame !== mb.window.webContents.mainFrame || event.senderFrame.url !== PANEL_URL) {
      throw new Error('Use esta ação pelo painel do CalangoClean.');
    }
  };
  ipcMain.handle('appearance:get', (event) => {
    assertPanelSender(event);
    return appearanceController.getState();
  });
  ipcMain.handle('appearance:set', (event, mode) => {
    assertPanelSender(event);
    return appearanceController.set(mode);
  });
  const completionFeedback = completionSound.create({ config });
  ipcMain.handle('feedback:get', event => {
    assertPanelSender(event);return completionFeedback.get();
  });
  ipcMain.handle('feedback:set', (event, enabled) => {
    assertPanelSender(event);return completionFeedback.set(enabled);
  });
  ipcMain.handle('feedback:complete', event => {
    assertPanelSender(event);return completionFeedback.complete();
  });
  // O renderer solicita as métricas enquanto Desempenho está visível; não há coleta na inicialização.
  const icons = appIcons.create({ getFileIcon: (...args) => app.getFileIcon(...args) });
  const privacyManager = privacy.create({getIcon:bundle=>icons.get(bundle)});
  ipcMain.handle('privacy:browsers',event=>{assertPanelSender(event);return privacyManager.list();});
  ipcMain.handle('privacy:open', (event,id)=>{assertPanelSender(event);return privacyManager.open(id);});
  const performanceManager = performance.create({
    selfPath: app.getAppPath?.() || path.join(__dirname, '..'),
    getIcon: bundle => icons.get(bundle),
  });
  ipcMain.handle('performance:list', async event => {
    assertPanelSender(event);
    return performanceManager.list();
  });
  ipcMain.handle('performance:metrics', async event => {
    assertPanelSender(event);
    if (!mb.window.isVisible()) return { ok: false, code: 'HIDDEN', error: 'O painel está oculto.' };
    return performanceManager.metrics();
  });
  ipcMain.handle('performance:prepare-process', async (event, pid, options = {}) => {
    assertPanelSender(event);
    const cfg = await config.load();
    return performanceManager.prepareProcess(pid, { force: options?.force === true, dryRun: cfg.dryRun });
  });
  ipcMain.handle('performance:prepare-service', async (event, id) => {
    assertPanelSender(event);
    const cfg = await config.load();
    return performanceManager.prepareService(id, { dryRun: cfg.dryRun });
  });
  async function performanceAction(event, request, kind) {
    assertPanelSender(event);
    return withMutation(async () => {
      const cfg = await config.load();
      const id = kind === 'process' ? 'processTerminate' : 'launchAgentUnload';
      await config.appendHistory({ source: 'ui', id, dryRun: cfg.dryRun, freedBytes: 0,
        skipped: false, note: 'Ação de desempenho confirmada pelo usuário.' });
      const result = kind === 'process'
        ? await performanceManager.terminate(request, { dryRun: cfg.dryRun })
        : await performanceManager.unloadService(request, { dryRun: cfg.dryRun });
      try {
        await config.appendHistory({ source: 'ui', id, dryRun: cfg.dryRun, freedBytes: 0,
          skipped: !result.ok, reason: result.error,
          note: result.ok ? (result.simulated ? 'Ação simulada.' : 'Ação solicitada ao macOS.') : 'Ação não concluída.' });
      } catch {
        result.warning = 'A ação foi processada, mas não foi possível registrar o resultado no histórico.';
      }
      return result;
    });
  }
  ipcMain.handle('performance:terminate', (event, request) => performanceAction(event, request, 'process'));
  ipcMain.handle('performance:unload-service', (event, request) => performanceAction(event, request, 'service'));
  const applicationRegistry = applications.create({
    selfPath: app.getAppPath?.() || path.join(__dirname,'..'),
    getIcon: bundle => icons.get(bundle),
    trashItem: target => shell.trashItem(target),
  });
  ipcMain.handle('applications:list', async event => {
    assertPanelSender(event);return applicationRegistry.list();
  });
  ipcMain.handle('applications:prepare', async (event,id) => {
    assertPanelSender(event);
    const cfg=await config.load();const result=await applicationRegistry.prepare(id);
    return {...result,dryRun:cfg.dryRun};
  });
  ipcMain.handle('applications:reveal', async (event,id) => {
    assertPanelSender(event);const target=await applicationRegistry.pathFor(id);
    if(!target)return {ok:false,error:'Aplicativo não encontrado. Atualize a lista.'};
    shell.showItemInFolder(target);return {ok:true};
  });
  ipcMain.handle('applications:uninstall', async (event,confirmation={}) => {
    assertPanelSender(event);const revision=mutations.revision();
    return withMutation(async()=>{
      const cfg=await config.load();
      await config.appendHistory({source:'ui',id:'uninstallApp',dryRun:cfg.dryRun,freedBytes:0,skipped:false,note:'Desinstalação confirmada pelo usuário.'});
      const result=await applicationRegistry.uninstall(confirmation,{dryRun:cfg.dryRun});
      if(result.ok&&result.movedToTrash){
        mutations.changed();categories.get('trashOld').invalidate();
        if(mb.window&&!mb.window.isDestroyed())mb.window.webContents.send('photos:changed');
      }
      await config.appendHistory({source:'ui',id:'uninstallApp',dryRun:cfg.dryRun,freedBytes:0,skipped:!result.ok,reason:result.error,note:result.ok?`${result.name}: ${cfg.dryRun?'envio simulado':'enviado à Lixeira; espaço não liberado imediatamente'}`:'Desinstalação não concluída.'}).catch(()=>{});
      return result;
    },{expectedRevision:revision});
  });
  photos = photoWindow.create({ withMutation, playCompletionSound: () => completionFeedback.complete(), appearanceView: () => appearanceController.getState(), onTrash: () => {
    mutations.changed();
    categories.get('trashOld').invalidate();
    if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('photos:changed');
  } });
  ipcMain.handle('photos:open', async (event) => {
    if (!mb.window || event.sender !== mb.window.webContents || event.senderFrame !== mb.window.webContents.mainFrame) {
      throw new Error('Abra a ferramenta pelo painel do CalangoClean.');
    }
    await photos.open();
    return { ok: true };
  });
  ipcMain.handle('app:init', async () => {
    const [info, { cfg, error }, machine, volume] = await Promise.all([
      disk.getDiskInfo(), config.loadSafe(), disk.getMachineInfo(), disk.getVolumeName(),
    ]);
    if (error) console.warn(`[config] ${error} Usando padrões só para exibir; nada será gravado.`);
    updateTrayTitle(info.free);
    return {
      dryRun: cfg.dryRun,
      version: app.getVersion(),
      soundEnabled: !error && cfg.soundEnabled !== false,
      ...appearanceController.getState(),
      disk: { ...info, volume },
      machine,
      updates: updateChecker.getState(),
      updateResult: lastUpdateResult,
      fullDiskAccess: lastUpdateResult ? await disk.hasFullDiskAccess().catch(() => true) : true,
      categories: categories.describeAll().map((c) => ({
        ...c,
        enabled: cfg.categories[c.id] ?? c.defaultEnabled,
      })),
    };
  });

  ipcMain.handle('disk:info', async () => {
    const info = await disk.getDiskInfo();
    updateTrayTitle(info.free);
    return info;
  });

  ipcMain.handle('updates:check', () => checkUpdates(true));
  ipcMain.handle('updates:install', async (event) => {
    // Só por clique no painel; o renderer não manda URL, hash nem caminho: tudo vem da última consulta.
    if (!mb.window || event.sender !== mb.window.webContents || event.senderFrame !== mb.window.webContents.mainFrame) {
      return { ok: false, error: 'Atualize pelo painel do CalangoClean.' };
    }
    const available = updateChecker.getState().available;
    if (!available) return { ok: false, error: 'Nenhuma atualização disponível.' };
    return installer.install(available, (p) => {
      if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('updates:progress', p);
    });
  });

  // Abrir o app de uma categoria (hoje só o WhatsApp). Ação fixa da própria categoria; não apaga nada.
  ipcMain.handle('category:open', (_e, id) => {
    const cat = categories.get(String(id));
    return cat && typeof cat.openApp === 'function' ? cat.openApp() : { ok: false, error: 'Ação indisponível.' };
  });

  // Prazo da Lixeira (trashDays). Só os valores oferecidos no card; grava só essa chave no config.
  ipcMain.handle('config:set-trash-days', async (_e, days) => {
    if (![0, 7, 15, 30].includes(days)) return { ok: false, error: 'Prazo inválido.' };
    try {
      const cfg = await config.update((c) => { c.trashDays = days; });
      config.appendHistory({
        source: 'ui', id: 'trashOld', dryRun: cfg.dryRun, freedBytes: 0, skipped: false, note: `trashDays ${days}`,
      }).catch(() => {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Não foi possível salvar o prazo: ${e.message}` };
    }
  });

  ipcMain.handle('category:analyze', (_e, id) => analyze(id));

  // O dryRun vem sempre da config lida no main, nunca do renderer.
  ipcMain.handle('categories:clean', async (_e, ids, confirmation = {}) => {
    const requestRevision = mutations.revision();
    // Config ilegível: assume os padrões (dryRun ligado), então nada é apagado e nada é gravado.
    const { cfg } = await config.loadSafe();
    // O painel informa o modo que o usuário viu, sem conseguir alterar o modo real.
    if (confirmation?.expectedDryRun !== cfg.dryRun) {
      throw new Error('O modo de limpeza mudou. Analise e confirme a limpeza novamente.');
    }
    const out = await withMutation(async () => {
      if (Array.isArray(ids) && ids.includes('trashOld') && confirmation.expectedRevision !== mutations.revision()) {
        throw new Error('O conteúdo da Lixeira mudou. Analise e confirme a limpeza novamente.');
      }
      const result = await cleaner.clean(ids, {
        dryRun: cfg.dryRun,
        closeBrowsers: confirmation?.closeBrowsers === true,
        skipBrowsers: confirmation?.skipBrowsers === true,
        onResult: (id, r) => config.appendHistory({ source: 'ui', id, dryRun: cfg.dryRun, ...r }).catch(() => {}),
      });
      if (!cfg.dryRun && result.results.some(r => r.id === 'trashOld' && !r.skipped)) mutations.changed();
      return result;
    }, { expectedRevision: requestRevision });
    if (!cfg.dryRun && out.results.some((r) => !r.skipped && r.status !== 'failed')) {
      await config.update((c) => { c.lastRun = new Date().toISOString(); }).catch(() => {});
    }
    return out;
  });

  // Persiste só o marcado/desmarcado; nunca aceita dryRun do renderer.
  ipcMain.handle('config:set-category', async (_e, id, enabled) => {
    const cat = categories.get(id);
    if (!cat || !categories.isCleanable(cat)) return false;
    await config.setCategoryEnabled(id, enabled === true);
    return true;
  });

  // "Mostrar no Finder": só arquivos que existem dentro de ~/Downloads.
  ipcMain.handle('finder:reveal', (_e, target) => {
    const root = categories.get('downloadsLarge').DIR;
    const t = path.resolve(String(target));
    if (!t.startsWith(root + path.sep) || !fs.existsSync(t)) return false;
    shell.showItemInFolder(t);
    return true;
  });

  // URLs fixas: Automação para o Finder, Acesso Total ao Disco para arquivos.
  ipcMain.on('app:open-privacy', (_e, permission) => {
    const pane = permission === 'automation' ? 'Privacy_Automation' : 'Privacy_AllFiles';
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  });

  // Discos externos: somente leitura. A única ação é ejetar, validada contra a listagem atual.
  ipcMain.handle('volumes:list', () => volumes.list());
  ipcMain.handle('volumes:eject', (_e, id) => volumes.eject(String(id)));
  ipcMain.handle('volumes:folders-last', (event, id) => { assertPanelSender(event); return volumeFolders.last(id); });
  ipcMain.handle('volumes:folders-analyze', (event, id) => { assertPanelSender(event); return volumeFolders.analyze(id); });
  ipcMain.handle('volumes:folders-cancel', (event, id) => { assertPanelSender(event); volumeFolders.cancel(id); return { ok: true }; });

  // Rede: leitura leve sempre; o teste de velocidade SÓ roda por clique (nunca automático, nunca no agendamento).
  ipcMain.handle('network:info', () => network.getInfo());
  ipcMain.handle('network:speed', () => network.speedTest());

  // Bluetooth: somente leitura (system_profiler). Sem ações; nada vem do painel.
  ipcMain.handle('bluetooth:list', () => bluetooth.list());

  // Gráfico do disco: medição de pastas SOMENTE LEITURA, só por clique. O resultado fica guardado com a data.
  ipcMain.handle('folders:last', () => folders.last());
  ipcMain.handle('folders:analyze', async () => {
    const { used } = await disk.getDiskInfo();
    return folders.analyze(used);
  });
  ipcMain.on('folders:cancel', () => folders.cancel());
  ipcMain.handle('folders:reveal', (_e, id) => {
    const p = folders.pathFor(String(id));
    if (!p) return false;
    shell.showItemInFolder(p);
    return true;
  });

  // "por Seja Calango": abre no navegador padrão. URL fixa no processo principal; nada vem do painel.
  ipcMain.on('app:open-site', () => { shell.openExternal(SITE_URL); });
  // Cadastro opcional usa o login que já existe no site; nenhum token/senha é recebido pelo app.
  ipcMain.handle('app:open-account', async (event) => {
    assertPanelSender(event);
    try { await shell.openExternal(`${SITE_URL}/#apps`); return { ok: true }; }
    catch { return { ok: false, error: 'Não foi possível abrir a Seja Calango.' }; }
  });

  ipcMain.handle('schedule:get', () => scheduleView());

  // Aceita só enabled/weekday/hour/minute (validados); o resto do config não passa por aqui.
  ipcMain.handle('schedule:set', async (_e, patch = {}) => {
    const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    const next = {};
    if ('enabled' in patch) next.enabled = patch.enabled === true;
    if ('weekday' in patch && int(patch.weekday, 0, 6)) next.weekday = patch.weekday;
    if ('hour' in patch && int(patch.hour, 0, 23)) next.hour = patch.hour;
    if ('minute' in patch && int(patch.minute, 0, 59)) next.minute = patch.minute;

    let cfg;
    try {
      cfg = await config.update((c) => { c.schedule = { ...c.schedule, ...next }; });
    } catch (e) {
      return scheduleView({ error: `Não foi possível salvar o agendamento: ${e.message}` });
    }
    // Trilha de auditoria: toda mudança de agendamento pedida pelo painel fica no history.log.
    config.appendHistory({
      source: 'ui', id: 'schedule', dryRun: cfg.dryRun, freedBytes: 0, skipped: false,
      note: `schedule ${JSON.stringify(next)}`,
    }).catch(() => {});
    try {
      // Pedido explícito do usuário: aqui (e só aqui) é permitido descarregar o agente.
      await scheduler.sync(cfg.schedule, undefined, { allowUninstall: true });
    } catch (e) {
      return scheduleView({ error: `Não foi possível atualizar o agendamento: ${e.message}` });
    }
    return scheduleView();
  });

  ipcMain.on('window:hide', () => mb.hideWindow());
  ipcMain.on('app:quit', () => mb.app.quit());
}

// O macOS só posiciona o item da barra de menu um instante depois de criá-lo; ler os bounds
// logo no ready dá x=0/h=0 mesmo com o ícone visível. Por isso confere algumas vezes e,
// se mesmo assim ele não tiver posição (escondido, sem espaço, desligado em
// Ajustes > Barra de Menus), abre a janela sozinha para o app não ficar inacessível.
function trayHasPosition() {
  const b = mb.tray.getBounds();
  return b.width > 0 && b.height > 0;
}

function watchTrayPosition() {
  let tries = 0;
  const check = () => {
    if (trayHasPosition()) {
      if (isDev) console.log('[tray] ícone posicionado na barra de menu');
      return;
    }
    if (++tries < 6) return void setTimeout(check, 500);
    console.warn('[tray] ícone sem posição na barra de menu; abrindo a janela como alternativa');
    if (mb.window) mb.window.setAlwaysOnTop(true); // não fecha ao perder o foco: não há ícone para reabrir
    mb.showWindow().catch((e) => console.error('[tray] showWindow falhou:', e.message));
  };
  setTimeout(check, 500);
}

mb.on('ready', async () => {
  if (isDev) app.dock?.setIcon(path.join(__dirname, '..', 'ui', 'app-icon.png'));
  // Primeira abertura após o renome limpa-mac -> calangoclean: copia os dados e remove o LaunchAgent antigo
  // ANTES de ler o config e de instalar o agente novo.
  await migrate.run().catch((e) => console.warn('[migrate] falhou:', e.message));
  await config.enableProduction().catch((e) => console.warn('[production] falhou:', e.message));
  await appearanceController.initialize().then((state) => {
    if (state.error) console.warn(`[appearance] ${state.error} Usando aparência automática sem gravar.`);
  }).catch((e) => console.warn('[appearance] falhou:', e.message));
  lastUpdateResult = await installer.takeResult();
  registerIpc();
  config.cleanLegacy().catch(() => {});
  // Mantém o launchd de acordo com o config (caminho do app mudou, agente descarregado etc.).
  // Só garante a instalação quando o config diz que está ligado. Se o config estiver ilegível, load() lança e nada acontece.
  config.load().then((c) => scheduler.sync(c.schedule)).catch(() => {});
  disk.getDiskInfo().then((i) => updateTrayTitle(i.free)).catch(() => {});
  if (isDev) {
    mb.showWindow().catch((e) => console.error('[dev] showWindow falhou:', e.message));
  }
  watchTrayPosition();
  checkUpdates().catch(() => {});
  mb.app.on('before-quit', () => installer.cancel());

  // Avisa o painel quando um disco externo entra/sai (fs.watch em /Volumes + polling de 5 s com a janela aberta).
  const stopVolumes = volumes.watch(
    (list) => { if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('volumes:changed', list); },
    { isActive: () => Boolean(mb.window && !mb.window.isDestroyed() && mb.window.isVisible()) },
  );
  mb.app.on('before-quit', () => { stopVolumes(); network.cancel(); folders.cancel(); volumeFolders.cancel(); photos?.destroy(); appearanceController.dispose(); });
});

mb.on('after-create-window', () => {
  // Nunca navega nem abre janelas dentro do app: links vão para o navegador padrão.
  mb.window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mb.window.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mb.window.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      _e.preventDefault();mb.window.webContents.send('window:escape');
    }
  });
});

// Em telas pequenas a janela não pode passar da área útil: encolhe a lista, nunca corta o rodapé.
mb.on('show', () => {
  if (!mb.window || mb.window.isDestroyed()) return;
  const area = screen.getDisplayNearestPoint(mb.tray.getBounds()).workArea;
  mb.window.setSize(
    Math.max(1, Math.min(WIN_W, Math.floor(area.width - 16))),
    Math.max(1, Math.min(WIN_H, Math.floor(area.height - 16))),
  );
});

mb.on('after-show', () => {
  mb.window.webContents.send('window:shown');
  // No máximo uma consulta a cada 6 h (o limite fica em updates.js).
  checkUpdates().catch(() => {});
});

mb.on('after-hide', () => {
  if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('window:hidden');
});
