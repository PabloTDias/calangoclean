const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

async function fixture(overrides = {}) {
  const handlers = new Map();
  const history = [];
  const calls = [];
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = true;
  const scanner = {
    roots: () => [{ id: 'pictures', label: 'Imagens', path: '/fixture/Pictures' }],
    snapshot: () => ({ scanId: 'scan', groups: [] }),
    cancel: () => calls.push('cancel'),
    scan: async ids => { calls.push(['scan', ids]); return { scanId: 'scan', groups: [] }; },
    safeFile: async id => { calls.push(['safe', id]); return { id, path: '/fixture/Pictures/photo.jpg' }; },
    trash: async args => {
      calls.push(['trash', args]);
      return { dryRun: args.dryRun, results: [{ id: 'copy', status: args.dryRun ? 'simulated' : 'moved' }], snapshot: { scanId: 'scan', groups: [] } };
    },
  };
  const fileScanner = {
    ...scanner,
    roots: () => [{ id: 'downloads', label: 'Downloads', path: '/fixture/Downloads' }],
    snapshot: () => ({ mode: 'files', scanId: 'file-scan', groups: [] }),
    safeFile: async id => { calls.push(['safe-file', id]); return { id, path: '/fixture/Downloads/report.pdf' }; },
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.backgroundColor = options.backgroundColor;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '' };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    isDestroyed() { return Boolean(this.destroyed); }
    isMinimized() { return false; }
    show() {}
    hide() {}
    focus() {}
    setBackgroundColor(value) { this.backgroundColor = value; }
    destroy() { this.destroyed = true; }
    async loadURL(url) { this.webContents.mainFrame.url = url; this.emit('ready-to-show'); }
  }
  const filename = path.join(__dirname, '..', 'src', 'photoWindow.js');
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, __dirname: path.dirname(filename), Buffer,
    require: id => id === 'electron' ? {
      BrowserWindow: FakeWindow,
      nativeTheme,
      ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
      screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { width: 1440, height: 900 } }) },
      nativeImage: { createThumbnailFromPath: async () => { calls.push('thumbnail'); return { isEmpty: () => false, toJPEG: () => Buffer.from('preview') }; } },
      shell: { showItemInFolder: target => calls.push(['reveal', target]) },
    } : id === './photoDuplicates' ? { create: options => options.mode === 'files' ? fileScanner : scanner } : originalRequire(id),
  }, { filename });
  const controller = module.exports.create({
    loadConfig: async () => ({ dryRun: false }),
    appendHistory: async record => history.push(record),
    onTrash: () => calls.push('changed'), ...overrides,
  });
  await controller.open();
  const win = controller.getWindow();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  return { scanner, fileScanner, history, calls, handlers, controller, event, nativeTheme, win,
    invoke: (channel, ...args) => handlers.get(channel)(event, ...args) };
}

test('duplicados recebe aparência compartilhada e atualiza fundo sem perder sua revisão', async () => {
  let view = { appearance: 'normal', colorScheme: 'light' };
  const f = await fixture({ appearanceView: () => view });
  let initial = await f.invoke('photos:init');
  assert.equal(initial.appearance, 'normal');
  assert.equal(initial.colorScheme, 'light');
  assert.equal(f.win.options.backgroundColor, '#fafbfa');
  view = { appearance: 'noturno', colorScheme: 'dark' };
  f.nativeTheme.emit('updated');
  assert.equal(f.win.backgroundColor, '#202320');
  initial = await f.invoke('photos:init', 'files');
  assert.equal(initial.appearance, 'noturno');
  assert.equal(initial.colorScheme, 'dark');
  assert.equal(initial.snapshot.scanId, 'file-scan');
  view = { appearance: 'automatico', colorScheme: 'light' };
  f.nativeTheme.emit('updated');
  assert.equal(f.win.backgroundColor, '#fafbfa');
  assert.equal((await f.invoke('photos:init')).appearance, 'automatico');
  assert.equal(f.calls.length, 0, 'trocar aparência não analisa nem movimenta arquivos');
  assert.equal(f.nativeTheme.listenerCount('updated'), 1);
  f.controller.destroy();
  assert.equal(f.nativeTheme.listenerCount('updated'), 0);
});

test('aviso de conclusão de duplicados só aceita seu próprio renderer',async()=>{
  let played=0;const f=await fixture({playCompletionSound:async()=>{played++;return{ok:true};}});
  assert.equal(played,0);
  await assert.rejects(f.handlers.get('photos:task-complete')({sender:{},senderFrame:f.event.senderFrame}),/janela de fotos/);
  await f.invoke('photos:task-complete');assert.equal(played,1);
});

test('IPC de fotos recusa outra janela e subframes, mesmo com a mesma URL', async () => {
  const f = await fixture();
  const handler = f.handlers.get('photos:scan');
  await assert.rejects(handler({ sender: {}, senderFrame: f.event.senderFrame }, ['pictures']), /janela de fotos/);
  await assert.rejects(handler({ sender: f.event.sender, senderFrame: { url: f.event.senderFrame.url } }, ['pictures']), /janela de fotos/);
  assert.equal(f.calls.length, 0);
});

test('modo confirmado diferente ou configuração ilegível bloqueia movimentação', async () => {
  const f = await fixture();
  await assert.rejects(f.invoke('photos:trash', { scanId: 'scan', ids: ['copy'], expectedDryRun: true }), /modo de limpeza mudou/);
  assert.equal(f.history.length, 0);
  assert.equal(f.calls.length, 0);
  const broken = await fixture({ loadConfig: async () => { throw new Error('config inválida'); } });
  assert.equal((await broken.invoke('photos:init')).dryRun, true);
  await assert.rejects(broken.invoke('photos:trash', { expectedDryRun: true }), /config inválida/);
  assert.equal(broken.calls.length, 0);
});

test('falha ao registrar intenção impede mover qualquer foto', async () => {
  const f = await fixture({ appendHistory: async () => { throw new Error('histórico indisponível'); } });
  await assert.rejects(f.invoke('photos:trash', { scanId: 'scan', ids: ['copy'], expectedDryRun: false }), /histórico indisponível/);
  assert.equal(f.calls.length, 0);
});

test('mutação concorrente da limpeza comum bloqueia o fluxo de fotos', async () => {
  const f = await fixture({ withMutation: async () => { throw new Error('Outra limpeza em andamento'); } });
  await assert.rejects(f.invoke('photos:trash', { expectedDryRun: false }), /Outra limpeza/);
  assert.equal(f.history.length, 0);
  assert.equal(f.calls.length, 0);
});

test('envio confirmado registra resultado sem espaço liberado e atualiza Lixeira do painel', async () => {
  const f = await fixture();
  const result = await f.invoke('photos:trash', { scanId: 'scan', ids: ['copy'], expectedDryRun: false, paths: ['/System/evil'] });
  assert.equal(result.moved.length, 1);
  assert.equal(result.simulated.length, 0);
  assert.equal(f.history.length, 2);
  assert.ok(f.history.every(record => record.freedBytes === 0));
  assert.equal(f.calls[0][0], 'trash');
  assert.equal(f.calls[0][1].paths, undefined);
  assert.deepEqual(Array.from(f.calls[0][1].ids), ['copy']);
  assert.equal(f.calls[1], 'changed');
});

test('simulação vem da configuração principal e não altera Lixeira do painel', async () => {
  const f = await fixture({ loadConfig: async () => ({ dryRun: true }) });
  const result = await f.invoke('photos:trash', { scanId: 'scan', ids: ['copy'], expectedDryRun: true });
  assert.equal(result.simulated.length, 1);
  assert.equal(result.moved.length, 0);
  assert.ok(!f.calls.includes('changed'));
});

test('prévia e Mostrar no Finder resolvem IDs validados no main', async () => {
  const f = await fixture();
  assert.match((await f.invoke('photos:thumbnail', 'photo')).dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(f.calls.filter(call => call[0] === 'safe').length, 2);
  f.scanner.safeFile = async () => { throw new Error('foto alterada'); };
  assert.ok((await f.invoke('photos:thumbnail', 'photo')).error);
  assert.equal((await f.invoke('photos:reveal', 'photo')).ok, false);
  assert.ok(!f.calls.some(call => call[0] === 'reveal'));
});

test('cada modo mantém suas raízes e análise no processo principal', async () => {
  const f = await fixture();
  const photos = await f.invoke('photos:init', 'photos');
  const files = await f.invoke('photos:init', 'files');
  assert.equal(photos.mode, 'photos');
  assert.equal(photos.roots[0].id, 'pictures');
  assert.equal(files.mode, 'files');
  assert.equal(files.roots[0].id, 'downloads');
  assert.equal(files.snapshot.scanId, 'file-scan');
});

test('modos desconhecidos não autorizam análise, leitura ou movimentação', async () => {
  const f = await fixture();
  await assert.rejects(f.invoke('photos:init', '__proto__'), /Escolha Fotos/);
  await assert.rejects(f.invoke('photos:scan', ['downloads'], 'system'), /Escolha Fotos/);
  await assert.rejects(f.invoke('photos:reveal', 'photo', 'all'), /Escolha Fotos/);
  await assert.rejects(f.invoke('photos:trash', { mode: 'all', expectedDryRun: false }), /Escolha Fotos/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.history.length, 0);
});

test('modo arquivos nunca abre documentos para gerar miniaturas', async () => {
  const f = await fixture();
  const result = await f.invoke('photos:thumbnail', 'report', 'files');
  assert.match(result.error, /apenas no modo Fotos/);
  assert.equal(f.calls.length, 0);
  await f.invoke('photos:reveal', 'report', 'files');
  assert.deepEqual(f.calls, [['safe-file', 'report'], ['reveal', '/fixture/Downloads/report.pdf']]);
});

test('confirmação de arquivos usa somente seu scanner e histórico próprio', async () => {
  const f = await fixture();
  f.scanner.trash = async () => assert.fail('não pode usar análise de fotos');
  f.fileScanner.trash = async args => ({ dryRun: args.dryRun, results: [{ id: args.ids[0], status: 'moved' }], snapshot: { scanId: 'file-scan', groups: [] } });
  const result = await f.invoke('photos:trash', { mode: 'files', scanId: 'file-scan', ids: ['report-copy'], expectedDryRun: false });
  assert.equal(result.mode, 'files');
  assert.equal(result.moved[0].id, 'report-copy');
  assert.ok(f.history.every(row => row.id === 'fileDuplicates' && row.mode === 'files' && row.freedBytes === 0));
});

test('busca de um modo impede nova busca ou remoção no outro', async () => {
  const f = await fixture();
  let finish;
  f.scanner.scan = () => new Promise(resolve => { finish = resolve; });
  const active = f.invoke('photos:scan', ['pictures'], 'photos');
  await assert.rejects(f.invoke('photos:scan', ['downloads'], 'files'), /busca.*andamento/);
  await assert.rejects(f.invoke('photos:trash', { mode: 'files' }), /conclusão da busca/);
  await f.invoke('photos:cancel', 'files');
  assert.equal(f.calls.length, 0, 'cancelamento do outro modo não interfere na busca ativa');
  await f.invoke('photos:cancel', 'photos');
  assert.deepEqual(f.calls, ['cancel']);
  finish({ scanId: 'scan', groups: [] });
  await active;
  assert.equal((await f.invoke('photos:scan', ['downloads'], 'files')).scanId, 'scan');
});
