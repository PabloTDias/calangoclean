const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const appearance = require('../src/appearance');

class Theme extends EventEmitter {
  constructor() { super(); this.source = 'system'; this.systemDark = false; }
  get themeSource() { return this.source; }
  set themeSource(value) { this.source = value; this.emit('updated'); }
  get shouldUseDarkColors() { return this.source === 'dark' || (this.source === 'system' && this.systemDark); }
  system(value) { this.systemDark = value; this.emit('updated'); }
}

function fixture(value = 'automatico') {
  const theme = new Theme();
  let cfg = { appearance: value, dryRun: true, categories: { logs: false }, custom: 42 };
  let writes = 0;
  const events = [];
  const config = {
    loadSafe: async () => ({ cfg, error: null }),
    update: async (mutate) => { writes++; const next = structuredClone(cfg); mutate(next); cfg = next; return cfg; },
  };
  const controller = appearance.create({ nativeTheme: theme, config, onChanged: (state) => events.push(state) });
  return { theme, config, controller, events, writes: () => writes, cfg: () => cfg };
}

test('modos persistidos controlam o tema do app e preservam outras preferências', async () => {
  const f = fixture('normal');
  assert.equal(f.theme.themeSource, 'system');
  assert.deepEqual(await f.controller.initialize(), { appearance: 'normal', colorScheme: 'light' });
  assert.equal(f.theme.themeSource, 'light');
  assert.deepEqual(await f.controller.set('noturno'), { ok: true, appearance: 'noturno', colorScheme: 'dark' });
  assert.equal(f.theme.themeSource, 'dark');
  assert.deepEqual(f.cfg(), { appearance: 'noturno', dryRun: true, categories: { logs: false }, custom: 42 });
  assert.equal(f.writes(), 1);
  f.controller.dispose();
  assert.equal(f.theme.listenerCount('updated'), 0);
});

test('automático acompanha mudanças do sistema e modos fixos não mudam de cor', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.theme.system(true);
  assert.deepEqual(f.controller.getState(), { appearance: 'automatico', colorScheme: 'dark' });
  assert.deepEqual(f.events.at(-1), { appearance: 'automatico', colorScheme: 'dark' });
  await f.controller.set('normal');
  const before = f.events.length;
  f.theme.system(false);
  f.theme.system(true);
  assert.equal(f.events.length, before);
  assert.deepEqual(f.controller.getState(), { appearance: 'normal', colorScheme: 'light' });
  await f.controller.set('automatico');
  assert.equal(f.theme.themeSource, 'system');
  assert.equal(f.controller.getState().colorScheme, 'dark');
  f.controller.dispose();
});

test('valores não oferecidos pela interface são recusados sem gravar nem mudar tema', async () => {
  const f = fixture('noturno');
  await f.controller.initialize();
  for (const value of ['dark', 'light', '', null, {}, ['normal'], '__proto__']) {
    const result = await f.controller.set(value);
    assert.equal(result.ok, false);
    assert.equal(result.appearance, 'noturno');
    assert.equal(result.colorScheme, 'dark');
  }
  assert.equal(f.writes(), 0);
  f.controller.dispose();
});

test('falha de config não sobrescreve arquivo e falha ao salvar mantém aparência anterior', async () => {
  const f = fixture('noturno');
  await f.controller.initialize();
  f.config.update = async () => { throw new Error('config.json inválido'); };
  const result = await f.controller.set('normal');
  assert.equal(result.ok, false);
  assert.equal(result.appearance, 'noturno');
  assert.equal(f.theme.themeSource, 'dark');
  assert.match(result.error, /config.json inválido/);
  f.controller.dispose();

  const nativeTheme = new Theme();
  const fallback = appearance.create({ nativeTheme, config: {
    loadSafe: async () => ({ cfg: { appearance: 'automatico' }, error: 'config.json inválido' }),
    update: async () => { throw new Error('não deve gravar'); },
  } });
  const initial = await fallback.initialize();
  assert.equal(initial.appearance, 'automatico');
  assert.equal(initial.error, 'config.json inválido');
  assert.equal(nativeTheme.themeSource, 'system');
  fallback.dispose();
});

async function mainFixture() {
  const source = await fs.readFile(require.resolve('../src/main'), 'utf8');
  const dirname = path.dirname(require.resolve('../src/main'));
  const page = pathToFileURL(path.join(dirname, '..', 'ui', 'index.html')).href;
  const handlers = new Map();
  const nativeTheme = new Theme();
  const app = Object.assign(new EventEmitter(), { isPackaged: true, isReady: () => true, getVersion: () => '0.4.0', getPath: () => '/Applications/CalangoClean.app/Contents/MacOS/CalangoClean' });
  const frame = { url: page };
  const sent = [];
  const opened = [];
  const applicationCalls=[];
  const performanceCalls=[];
  const soundCalls=[];
  const privacyCalls=[];
  const history=[];
  const webContents = Object.assign(new EventEmitter(), { mainFrame: frame, send: (...args) => sent.push(args) });
  const size = [];
  const window = { webContents, isDestroyed: () => false, isVisible: () => true, setSize: (...args) => size.push(args) };
  const mb = Object.assign(new EventEmitter(), { app, window,
    tray: { getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }), setTitle() {} }, showWindow: async () => {},
  });
  const screen = { area: { width: 1200, height: 900 }, getDisplayNearestPoint() { return { workArea: this.area }; } };
  const config = {
    loadSafe: async () => ({ cfg: { appearance: 'normal', dryRun: true, categories: {}, schedule: {} }, error: null }),
    update: async (fn) => { const cfg = { appearance: 'normal' }; fn(cfg); return cfg; },
    enableProduction: async () => {}, cleanLegacy: async () => {}, load: async () => ({ schedule: {},dryRun:true }), appendHistory:async entry=>{history.push(entry);},
  };
  let photoOptions, installerOptions;
  const installCalls = [];
  const imports = {
    electron: { app, nativeTheme, BrowserWindow: { getAllWindows: () => [window] },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, screen,
      Notification: { isSupported: () => false }, shell: { openExternal: async (url) => { opened.push(url); } } },
    menubar: { menubar: () => mb },
    './config': config,
    './appearance': appearance,
    './appIcons': require('../src/appIcons'),
    './privacy':{create:()=>({list:async()=>{privacyCalls.push('list');return{ok:true,browsers:[]};},open:async id=>{privacyCalls.push(['open',id]);return{ok:true,opened:true,deleted:false};}})},
    './completionSound': {create:options=>require('../src/completionSound').create({...options,play:async()=>{soundCalls.push('play');}})},
    './applications':{create:()=>({list:async()=>{applicationCalls.push('list');return{ok:true,items:[]};},prepare:async id=>{applicationCalls.push(['prepare',id]);return{ok:true,id,token:'fixture-token'};},uninstall:async(request,cfg)=>{applicationCalls.push(['uninstall',request,cfg]);return{ok:true,dryRun:true,movedToTrash:false,name:'Fixture'};},pathFor:async()=>null})},
    './performance':{create:()=>({
      list:async()=>{performanceCalls.push(['list']);return{processes:[],services:[]};},
      metrics:async()=>{performanceCalls.push(['metrics']);return{ok:true,systemMetrics:{cpuPercent:25,memoryUsedBytes:12,memoryTotalBytes:16}};},
      prepareProcess:async(pid,options)=>{performanceCalls.push(['prepareProcess',pid,options]);return{ok:true,pid,token:'process-token',...options};},
      prepareService:async(id,options)=>{performanceCalls.push(['prepareService',id,options]);return{ok:true,id,token:'service-token',...options};},
      terminate:async(request,options)=>{performanceCalls.push(['terminate',request,options]);return{ok:true,simulated:options.dryRun};},
      unloadService:async(request,options)=>{performanceCalls.push(['unloadService',request,options]);return{ok:true,simulated:options.dryRun};},
    })},
    './disk': { getDiskInfo: async () => ({ free: 100, used: 200 }), getMachineInfo: async () => ({}), getVolumeName: async () => 'Macintosh HD' },
    './categories': { describeAll: () => [] }, './browsers': {},
    './cleaner': { create: () => ({}) }, './scheduler': { sync: async () => {} },
    './volumes': { watch: () => () => {} }, './network': {}, './bluetooth': {}, './folders': {},
    './volumeFolders': { create: () => ({ last: async id => ({ ok: true, result: null }), analyze: async id => ({ ok: true, result: { items: [] } }), cancel() {} }) },
    './migrate': { run: async () => {} },
    './updates': { create: () => ({ check: async () => ({}), getState: () => ({ available: { version: '9.9.9' } }) }), INTERVAL: 1000 },
    './updateInstaller': { create: options => { installerOptions = options; return { install: async (available) => { installCalls.push(available); return { ok: true }; }, takeResult: async () => null, cancel() {} }; } },
    './photoWindow': { create: (options) => { photoOptions = options; return {}; } },
    './mutationGate': { create: () => ({ run: (fn) => fn(), revision: () => 0 }) },
  };
  vm.runInNewContext(source, { __dirname: dirname, module: { exports: {} }, console,
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
    require: (id) => Object.hasOwn(imports, id) ? imports[id] : require(id),
  });
  await mb.listeners('ready')[0]();
  return { installCalls, installerOptions: () => installerOptions, handlers, nativeTheme, mb, window, frame, sent, opened, screen, size, photoOptions,applicationCalls,performanceCalls,config,history,soundCalls,privacyCalls };
}

test('IPC de aparência aceita só o painel principal e propaga tema a duplicados', async () => {
  const f = await mainFixture();
  const event = { sender: f.window.webContents, senderFrame: f.frame };
  const init = await f.handlers.get('app:init')(event);
  assert.equal(init.version, '0.4.0');
  assert.equal(init.appearance, 'normal');
  assert.equal(init.colorScheme, 'light');
  assert.deepEqual(f.photoOptions.appearanceView(), { appearance: 'normal', colorScheme: 'light' });
  const result = await f.handlers.get('appearance:set')(event, 'noturno');
  assert.equal(result.ok, true);
  assert.equal(result.colorScheme, 'dark');
  assert.equal(f.sent.at(-1)[0], 'appearance:changed');
  assert.equal(f.sent.at(-1)[1].appearance, 'noturno');
  assert.equal(f.photoOptions.appearanceView().appearance, 'noturno');
  assert.throws(() => f.handlers.get('appearance:set')({ sender: {}, senderFrame: f.frame }, 'normal'), /pelo painel/);
  assert.throws(() => f.handlers.get('appearance:get')({ sender: f.window.webContents, senderFrame: { url: f.frame.url } }), /pelo painel/);
  f.frame.url = 'file:///outra-pagina.html';
  assert.throws(() => f.handlers.get('appearance:set')(event, 'normal'), /pelo painel/);
});

test('painel 420×660 respeita a área útil mesmo em telas menores', async () => {
  const f = await mainFixture();
  const resize = f.mb.listeners('show')[0];
  resize();
  assert.deepEqual(f.size.at(-1), [420, 660]);
  f.screen.area = { width: 300, height: 450 };
  resize();
  assert.deepEqual(f.size.at(-1), [284, 434]);
  f.screen.area = { width: 8, height: 12 };
  resize();
  assert.deepEqual(f.size.at(-1), [1, 1]);
});

test('acesso opcional à Seja Calango aceita só o painel e abre URL fixa, sem receber senha', async () => {
  const f = await mainFixture();
  const event = { sender: f.window.webContents, senderFrame: f.frame };
  const handler = f.handlers.get('app:open-account');
  assert.equal((await handler(event, 'https://outro-destino.invalid')).ok, true);
  assert.deepEqual(f.opened, ['https://sejacalango.com.br/#apps']);
  await assert.rejects(handler({ sender: {}, senderFrame: f.frame }), /pelo painel/);
  assert.equal(f.opened.length, 1);
});

test('APIs de aplicativos só aceitam o painel e leem o modo de limpeza no main',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  for(const channel of ['applications:list','applications:prepare','applications:uninstall','applications:reveal']){
    await assert.rejects(f.handlers.get(channel)({sender:{},senderFrame:f.frame},'fixture'),/pelo painel/);
  }
  assert.equal(f.applicationCalls.length,0);
  assert.equal((await f.handlers.get('applications:list')(event)).ok,true);
  const prepared=await f.handlers.get('applications:prepare')(event,'fixture');
  assert.equal(prepared.dryRun,true);
  await f.handlers.get('applications:uninstall')(event,{id:'fixture',token:prepared.token,expectedDryRun:false});
  assert.equal(f.applicationCalls.at(-1)[2].dryRun,true,'o pedido não pode alterar o modo real');
});

test('Privacidade só aceita o painel e não inicia tarefas na abertura do app',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  assert.equal(f.privacyCalls.length,0);
  for(const channel of ['privacy:browsers','privacy:open']) {
    await assert.rejects(async()=>f.handlers.get(channel)({sender:{},senderFrame:f.frame},'chrome'),/pelo painel/);
    await assert.rejects(async()=>f.handlers.get(channel)({sender:f.window.webContents,senderFrame:{url:f.frame.url}},'chrome'),/pelo painel/);
  }
  await f.handlers.get('privacy:browsers')(event);
  const result=await f.handlers.get('privacy:open')(event,'chrome','https://example.com');
  assert.equal(result.deleted,false);assert.deepEqual(f.privacyCalls,['list',['open','chrome']]);
});

test('som só aceita o painel e compartilha a preferência com duplicados',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  assert.equal(f.soundCalls.length,0);
  for(const channel of ['feedback:get','feedback:set','feedback:complete']) {
    await assert.rejects(async()=>f.handlers.get(channel)({sender:{},senderFrame:f.frame},false),/pelo painel/);
    await assert.rejects(async()=>f.handlers.get(channel)({sender:f.window.webContents,senderFrame:{url:f.frame.url}},false),/pelo painel/);
  }
  assert.equal((await f.handlers.get('feedback:complete')(event,'/arbitrary/sound')).played,true);
  assert.equal(f.soundCalls.length,1);
  await f.photoOptions.playCompletionSound();assert.equal(f.soundCalls.length,2);
  assert.equal((await f.handlers.get('feedback:set')(event,false)).enabled,false);
});

test('Desempenho coleta somente por pedido do painel e recusa outro frame',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  assert.equal(f.performanceCalls.length,0,'abrir o app não deve coletar processos');
  for(const channel of ['performance:list','performance:metrics','performance:prepare-process','performance:prepare-service','performance:terminate','performance:unload-service']){
    await assert.rejects(f.handlers.get(channel)({sender:{},senderFrame:f.frame},123),/pelo painel/);
    await assert.rejects(f.handlers.get(channel)({sender:f.window.webContents,senderFrame:{url:f.frame.url}},123),/pelo painel/);
  }
  assert.equal(f.performanceCalls.length,0);
  await f.handlers.get('performance:list')(event);
  assert.deepEqual(f.performanceCalls,[['list']]);
});

test('métricas de Desempenho usam o endpoint dedicado somente para o painel visível', async () => {
  const f = await mainFixture();
  const event = { sender: f.window.webContents, senderFrame: f.frame };
  assert.equal((await f.handlers.get('performance:metrics')(event)).systemMetrics.cpuPercent, 25);
  assert.deepEqual(f.performanceCalls, [['metrics']]);
  f.window.isVisible = () => false;
  assert.equal((await f.handlers.get('performance:metrics')(event)).code, 'HIDDEN');
  assert.deepEqual(f.performanceCalls, [['metrics']]);
});

test('análise dos discos externos aceita somente o painel principal e mantém IPC próprio', async () => {
  const f = await mainFixture();
  const event = { sender: f.window.webContents, senderFrame: f.frame };
  for (const channel of ['volumes:folders-last', 'volumes:folders-analyze', 'volumes:folders-cancel']) {
    assert.throws(() => f.handlers.get(channel)({ sender: {}, senderFrame: f.frame }, 'disk9s1'), /pelo painel/);
    assert.throws(() => f.handlers.get(channel)({ sender: f.window.webContents, senderFrame: { url: f.frame.url } }, 'disk9s1'), /pelo painel/);
    assert.equal((await f.handlers.get(channel)(event, 'disk9s1')).ok, true);
  }
});

test('Desempenho lê dryRun no main, registra ações e não aceita modo fornecido pelo painel',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  const prepared=await f.handlers.get('performance:prepare-process')(event,123,{force:true,dryRun:false});
  assert.equal(prepared.dryRun,true);
  assert.equal(prepared.force,true);
  const request={pid:123,token:prepared.token,force:true,expectedDryRun:false,dryRun:false};
  assert.equal((await f.handlers.get('performance:terminate')(event,request)).simulated,true);
  assert.equal(f.performanceCalls.at(-1)[2].dryRun,true);
  const service=await f.handlers.get('performance:prepare-service')(event,'opaque-service');
  assert.equal(service.dryRun,true);
  await f.handlers.get('performance:unload-service')(event,{id:service.id,token:service.token,expectedDryRun:false});
  assert.equal(f.performanceCalls.at(-1)[2].dryRun,true);
  assert.deepEqual(f.history.map(entry=>entry.id),['processTerminate','processTerminate','launchAgentUnload','launchAgentUnload']);
  assert.ok(f.history.every(entry=>entry.freedBytes===0&&entry.dryRun));
});

test('config ilegível ou falha ao registrar intenção bloqueia ações de Desempenho',async()=>{
  const f=await mainFixture();const event={sender:f.window.webContents,senderFrame:f.frame};
  f.config.load=async()=>{throw Error('config ilegível');};
  await assert.rejects(f.handlers.get('performance:terminate')(event,{}),/config ilegível/);
  await assert.rejects(f.handlers.get('performance:prepare-process')(event,123),/config ilegível/);
  f.config.load=async()=>({dryRun:false});
  f.config.appendHistory=async()=>{throw Error('histórico indisponível');};
  await assert.rejects(f.handlers.get('performance:unload-service')(event,{}),/histórico indisponível/);
  assert.equal(f.performanceCalls.length,0);
});

test('atualização dentro do app só parte do painel principal e não recebe URL, hash ou caminho', async () => {
  const ctx = await mainFixture();
  const install = ctx.handlers.get('updates:install');
  assert.equal(ctx.handlers.has('updates:download'), false);
  const foreign = await install({ sender: {}, senderFrame: {} }, { url: 'https://evil.example/a.dmg' });
  assert.equal(foreign.ok, false);
  assert.equal(ctx.installCalls.length, 0);
  const own = await install({ sender: ctx.window.webContents, senderFrame: ctx.window.webContents.mainFrame }, { url: 'https://evil.example/a.dmg' });
  assert.equal(own.ok, true);
  assert.deepEqual(ctx.installCalls, [{ version: '9.9.9' }], 'usa só a atualização validada da última consulta');
});
