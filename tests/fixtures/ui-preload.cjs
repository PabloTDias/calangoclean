// Test bridge only: this preload never imports the application main process,
// scanners, filesystem helpers, launchd, shell, networkQuality or the real IPC API.
const { contextBridge } = require('electron');
const clone = value => JSON.parse(JSON.stringify(value));
const calls = [];
const events = {};
const record = (name, ...args) => calls.push({ name, args: clone(args) });
const listen = name => callback => { (events[name] ||= []).push(callback); return () => { events[name] = events[name].filter(fn => fn !== callback); }; };
const emit = (name, payload) => (events[name] || []).forEach(fn => fn(clone(payload)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const cats = [
  { id:'caches', label:'Caches de apps', level:'seguro', defaultEnabled:true, hint:'Arquivos temporários.', detail:'Arquivos temporários em Biblioteca / Caches.' },
  { id:'logs', label:'Logs', level:'seguro', defaultEnabled:true, hint:'Registros de aplicativos.' },
  { id:'chromeServiceWorker', label:'Cache de navegadores', level:'seguro', defaultEnabled:true, hint:'Caches de navegadores.', requiresBrowserQuit:true },
  { id:'trashOld', label:'Lixeira', level:'atencao', defaultEnabled:true, hint:'', detail:'A exclusão é definitiva.', option:'trashDays' },
  { id:'devCaches', label:'Caches de dev', level:'seguro', defaultEnabled:false, hint:'Homebrew, npm e pip.' },
  { id:'downloadsLarge', label:'Downloads grandes e antigos', level:'revisar', hint:'Arquivos com mais de 500 MB e 60 dias.' },
  { id:'whatsapp', label:'WhatsApp', level:'manual', hint:'Limpe pelo WhatsApp.', highlightAbove:1e9, actionLabel:'Abrir WhatsApp', featuredHint:'Limpe em Ajustes > Armazenamento > Gerenciar armazenamento.' },
  { id:'chromeIndexedDB', label:'Chrome IndexedDB', level:'manual', hint:'Limpe pelos ajustes do Chrome.' },
];
const disk = { volume:'Macintosh HD', free:149.6e9, used:362.4e9, total:512e9 };
const folders = { at:'2026-11-06T12:00:00.000Z', items:[
  ['apps','Aplicativos',76e9],['documents','Documentos',38e9],['downloads','Downloads',18e9],['movies','Filmes',42e9],['pictures','Imagens',64e9],['library','Biblioteca',82e9],['system','Sistema e outros',42.4e9],
].map(([id,label,bytes])=>({id,label,bytes,canReveal:id!=='system',partial:id==='library'})) };
const defaultAnalyses = Object.fromEntries(cats.map((cat,index)=>[cat.id,{id:cat.id,found:true,bytes:[2.42e9,.18e9,.64e9,1.2e9,1.56e9,1.8e9,3.1e9,.96e9][index],blockedReason:null,accessIssue:null,mutationRevision:1,details:[],canOpen:cat.id==='whatsapp',settings:cat.id==='trashOld'?{days:7,eligibleCount:3}:null}]));
defaultAnalyses.downloadsLarge.details=[{label:'gravacao.mov',bytes:1.1e9,path:'/fixture/Downloads/gravacao.mov'},{label:'arquivo.zip',bytes:.7e9,path:'/fixture/Downloads/arquivo.zip'}];
defaultAnalyses.chromeIndexedDB.details=[{label:'app.exemplo.test',bytes:.42e9},{label:'docs.exemplo.test',bytes:.25e9},{label:'mensagens.exemplo.test',bytes:.16e9},{label:'notas.exemplo.test',bytes:.09e9},{label:'outros.exemplo.test',bytes:.04e9}];
const performanceFixture={
  systemMetrics:{cpuPercent:27.5,memoryUsedBytes:12e9,memoryTotalBytes:16e9},
  processes:[
    {id:'group-editor',pid:4101,pids:[4101,4111,4112],processCount:3,isAppGroup:true,name:'Editor de exemplo',icon:fixtureIcon,cpu:18.4,memoryBytes:640e6,elapsedSeconds:3725,canTerminate:true,canForce:false,blockedReason:null},
    {pid:4102,name:'Render de exemplo',cpu:82.6,memoryBytes:240e6,elapsedSeconds:95,canTerminate:true,canForce:false,blockedReason:null},
    {pid:4103,name:'Finder',cpu:1.2,memoryBytes:128e6,elapsedSeconds:86400,canTerminate:false,canForce:false,blockedReason:'Processo protegido do sistema.'},
  ],
  memoryPressure:{level:'normal',freePercent:42},
  services:[
    {id:'service-example',label:'com.exemplo.sincronizador',pid:5101,canUnload:true,blockedReason:null},
    {id:'service-protected',label:'com.sejacalango.calangoclean.auto',pid:5102,canUnload:false,blockedReason:'O agendamento do CalangoClean é protegido.'},
  ],sampledAt:'2026-11-09T15:30:00.000Z',
};
const model={
  version:'0.4.3',
  privacyBrowsers:[{id:'chrome',name:'Google Chrome',icon:fixtureIcon,actionLabel:'Abrir opções de limpeza',instructions:'Confira o perfil, escolha o período e confirme no navegador.'},{id:'safari',name:'Safari',actionLabel:'Abrir navegador',instructions:'Histórico → Limpar Histórico. Safari → Ajustes → Privacidade → Gerenciar Dados de Sites.'}],privacyError:false,privacyOpenError:false,privacyDelay:0,
  dryRun:true, soundEnabled:true,soundSaveError:false,soundPlaybackError:false,appearance:'automatico', colorScheme:'light', categories:clone(cats).map(c=>({...c,enabled:c.defaultEnabled})), analyses:clone(defaultAnalyses),disk:clone(disk),
  volumes:[{id:'disk-fixture',name:'SSD de trabalho',path:'/Volumes/fixture',format:'APFS',protocol:'USB',kind:'usb',free:740e9,used:260e9,total:1e12,ejectable:true,writable:true}],
  bluetooth:[{name:'Teclado de exemplo',kind:'keyboard',battery:82},{name:'Mouse de exemplo',kind:'mouse',battery:14},{name:'Fones de exemplo',kind:'headphones',battery:null},{name:'Controle de exemplo',kind:'gamepad',battery:58}],
  network:{connected:true,type:'wifi',label:'Wi-Fi',name:'Rede de exemplo',interface:'en0',ip:'192.0.2.42',ssidHidden:false},
  schedule:{enabled:false,weekday:1,hour:8,minute:30,minDaysBetween:5,last:'2026-11-02T11:30:00.000Z',dryRun:true,loaded:false},
  updates:{current:'0.4.2',available:null,error:null},
  applications:[
    {id:'app-editor',name:'Editor de exemplo',icon:fixtureIcon,lastUsedAt:new Date(Date.now()-42*86400000).toISOString(),path:'/Applications/Editor de exemplo.app',bytes:240e6,version:'2.3.1',canUninstall:true,running:false},
    {id:'app-running',name:'App em uso',path:'/Applications/App em uso.app',bytes:96e6,version:'1.0',canUninstall:false,running:true,reason:'Feche o aplicativo antes de desinstalar.'},
    {id:'app-protected',name:'Aplicativo protegido',path:'/Applications/Aplicativo protegido.app',bytes:null,version:'1.0',canUninstall:false,running:false,reason:'Aplicativo protegido do sistema.'},
  ], applicationsError:false,prepareUninstallError:false,prepareUninstallDelay:0,uninstallError:false,
  performance:clone(performanceFixture),performanceError:false,performanceDelay:0,performanceMetrics:null,performanceMetricsError:false,performanceMetricsDelay:0,prepareProcessDelay:0,prepareProcessError:false,terminateProcessError:false,processExits:false,prepareServiceError:false,unloadServiceError:false,
  speed:{ok:true,downMbps:284.6,upMbps:92.4,latencyMs:12}, speedDelay:30, foldersDelay:30, folderResult:clone(folders),
  categoryError:false, scheduleError:false, updateError:false, downloadError:false, ejectError:false, cleanError:false, cleanPartial:false, photoOpenError:false,
};
let folderCancelled=false;
let uninstallSequence=0;
const uninstallTokens=new Map();
let performanceSequence=0;
const performanceTokens=new Map();
const performanceMetricStats={active:0,maxActive:0,started:[]};
const mainApi={
  getPrivacyBrowsers:async()=>{record('getPrivacyBrowsers');await wait(model.privacyDelay);return model.privacyError?{ok:false,error:'Não foi possível listar os navegadores.'}:{ok:true,browsers:clone(model.privacyBrowsers)};},
  openPrivacyBrowser:async id=>{record('openPrivacyBrowser',id);return model.privacyOpenError?{ok:false,error:'Não foi possível abrir o navegador.'}:{ok:true,opened:true,deleted:false,message:'Navegador aberto. Escolha o período e confirme os dados a excluir no navegador.'};},
  init:async()=>{record('init');return clone({version:model.version,dryRun:model.dryRun,soundEnabled:model.soundEnabled,appearance:model.appearance,colorScheme:model.colorScheme,disk:model.disk,machine:{name:'Mac de teste',chip:'Apple Silicon'},updates:model.updates,categories:model.categories});},
  setCompletionSound:async enabled=>{record('setCompletionSound',enabled);if(model.soundSaveError)return{ok:false,enabled:model.soundEnabled,error:'Falha ao salvar o som.'};model.soundEnabled=enabled;return{ok:true,enabled};},
  taskComplete:async()=>{record('taskComplete');if(model.soundPlaybackError)throw Error('Áudio indisponível.');if(model.soundEnabled)record('soundPlayed');return{ok:true,played:model.soundEnabled};},
  diskInfo:async()=>{record('diskInfo');return clone(model.disk);},
  analyze:async id=>{record('analyze',id);return clone(model.analyses[id]);},
  setCategory:async(id,enabled)=>{record('setCategory',id,enabled);if(model.categoryError)throw Error('Falha de gravação simulada.');model.categories.find(c=>c.id===id).enabled=enabled;return true;},
  setTrashDays:async days=>{record('setTrashDays',days);model.analyses.trashOld.settings={...model.analyses.trashOld.settings,days};model.analyses.trashOld.bytes=({0:2.4e9,7:1.2e9,15:.76e9,30:.31e9})[days]??0;return{ok:true};},
  clean:async(ids,confirmation)=>{record('clean',ids,confirmation);if(model.cleanError)throw Error('Falha de limpeza simulada.');return {dryRun:model.dryRun,results:ids.map(id=>({id,freedBytes:model.cleanAllFailed?0:model.analyses[id].bytes,skipped:!!model.cleanAllFailed,status:model.cleanAllFailed?'failed':model.cleanPartial&&id==='trashOld'?'partial':'ok',reason:model.cleanAllFailed?'Não foi possível limpar os itens.':model.cleanPartial&&id==='trashOld'?'bloqueado.pdf: Sem permissão.':model.dryRun?'simulação':''}))};},
  getVolumes:async()=>clone(model.volumes),onVolumes:listen('volumes'),
  lastVolumeFolders:async id=>{record('lastVolumeFolders',id);return{ok:true,result:null};},
  analyzeVolumeFolders:async id=>{record('analyzeVolumeFolders',id);await wait(30);return{ok:true,result:{at:'2026-11-09T18:00:00Z',used:260e9,items:[{id:'documents',label:'Trabalho',bytes:160e9},{id:'movies',label:'Vídeos',bytes:80e9},{id:'undetailed',label:'Sistema e não detalhado',bytes:20e9}],note:'Espaço por pastas.',partial:false}};},
  cancelVolumeFolders:async id=>{record('cancelVolumeFolders',id);return{ok:true};},
  ejectVolume:async id=>{record('ejectVolume',id);return model.ejectError?{ok:false,error:'Disco em uso pelo Finder.'}:{ok:true};},
  getNetwork:async()=>clone(model.network),runSpeedTest:async()=>{record('runSpeedTest');await wait(model.speedDelay);return clone(model.speed);},
  getBluetooth:async()=>clone(model.bluetooth),
  lastFolders:async()=>{record('lastFolders');return null;},
  analyzeFolders:async()=>{record('analyzeFolders');folderCancelled=false;await wait(model.foldersDelay);return folderCancelled?{ok:false,cancelled:true}:{ok:true,result:clone(model.folderResult)};},
  cancelFolders:()=>{record('cancelFolders');folderCancelled=true;},
  revealFolder:async id=>{record('revealFolder',id);return true;},reveal:async file=>{record('reveal',file);return true;},
  openCategory:async id=>{record('openCategory',id);return {ok:true};},
  getApplications:async()=>{record('getApplications');if(model.applicationsError)return{ok:false,items:[],error:'Não foi possível listar os aplicativos.'};return{ok:true,items:clone(model.applications),errors:[],dryRun:model.dryRun};},
  prepareUninstall:async id=>{record('prepareUninstall',id);await wait(model.prepareUninstallDelay);const item=model.applications.find(item=>item.id===id);if(!item)return{ok:false,error:'Aplicativo não encontrado. Atualize a lista.'};if(!item.canUninstall||model.prepareUninstallError)return{ok:false,error:item.reason||'O aplicativo está em uso. Feche-o e tente novamente.'};const token=`fixture-uninstall-${++uninstallSequence}`;uninstallTokens.set(token,{id,dryRun:model.dryRun});return{ok:true,...clone(item),token,dryRun:model.dryRun};},
  uninstallApp:async consent=>{record('uninstallApp',consent);const prepared=uninstallTokens.get(consent.token);uninstallTokens.delete(consent.token);const item=model.applications.find(item=>item.id===consent.id);if(!prepared||prepared.id!==consent.id)return{ok:false,error:'Confirmação inválida. Revise o aplicativo novamente.'};if(consent.expectedDryRun!==model.dryRun||prepared.dryRun!==model.dryRun)return{ok:false,error:'O modo de limpeza mudou. Revise o aplicativo novamente.'};if(model.uninstallError||!item?.canUninstall)return{ok:false,error:item?.reason||'O aplicativo está em uso. Feche-o e tente novamente.'};if(!model.dryRun)model.applications=model.applications.filter(item=>item.id!==consent.id);return{ok:true,dryRun:model.dryRun,app:clone(item)};},
  revealApplication:async id=>{record('revealApplication',id);return{ok:true};},
  getPerformance:async()=>{record('getPerformance');performanceTokens.clear();await wait(model.performanceDelay);if(model.performanceError)throw Error('Não foi possível ler os processos.');return clone(model.performance);},
  getPerformanceMetrics:async()=>{
    record('getPerformanceMetrics');
    const value=model.performanceMetrics||model.performance;
    const result=clone({ok:true,processes:Object.hasOwn(value,'processes')?value.processes:model.performance.processes,processError:value.processError||null,systemMetrics:value.systemMetrics,memoryPressure:value.memoryPressure,pressureError:value.pressureError||null,sampledAt:value.sampledAt});
    const error=model.performanceMetricsError,ms=model.performanceMetricsDelay;
    performanceMetricStats.active++;
    performanceMetricStats.maxActive=Math.max(performanceMetricStats.maxActive,performanceMetricStats.active);
    performanceMetricStats.started.push(Date.now());
    try{await wait(ms);if(error)throw Error('Não foi possível atualizar os marcadores.');return result;}
    finally{performanceMetricStats.active--;}
  },
  prepareProcess:async(pid,{force=false}={})=>{
    record('prepareProcess',pid,{force});await wait(model.prepareProcessDelay);
    const item=model.performance.processes.find(item=>item.pid===pid);
    if(model.prepareProcessError||!item?.canTerminate||force&&!item.canForce)return{ok:false,error:item?.blockedReason||'O processo mudou. Atualize a lista.'};
    const token=`fixture-process-${++performanceSequence}`;
    performanceTokens.set(token,{kind:'process',pid,force,dryRun:model.dryRun});
    return{ok:true,token,pid,pids:item.pids||[pid],processCount:item.processCount||1,isAppGroup:item.isAppGroup===true,name:item.name,force,dryRun:model.dryRun};
  },
  terminateProcess:async consent=>{
    record('terminateProcess',consent);const prepared=performanceTokens.get(consent.token);performanceTokens.delete(consent.token);
    if(!prepared||prepared.kind!=='process'||prepared.pid!==consent.pid||prepared.force!==consent.force)return{ok:false,error:'Confirmação inválida. Atualize a lista.'};
    if(prepared.dryRun!==model.dryRun||consent.expectedDryRun!==model.dryRun)return{ok:false,error:'O modo de simulação mudou. Revise o processo novamente.'};
    if(model.terminateProcessError)return{ok:false,error:'O processo mudou. Atualize a lista.'};
    const item=model.performance.processes.find(item=>item.pid===consent.pid);
    if(!item?.canTerminate)return{ok:false,error:'Processo protegido.'};
    const exited=!model.dryRun&&(model.processExits||consent.force);
    if(exited)model.performance.processes=model.performance.processes.filter(item=>item.pid!==consent.pid);
    else if(!model.dryRun)item.canForce=true;
    return{ok:true,simulated:model.dryRun,exited,canForce:!model.dryRun&&!exited};
  },
  prepareService:async id=>{
    record('prepareService',id);const item=model.performance.services.find(item=>item.id===id);
    if(model.prepareServiceError||!item?.canUnload)return{ok:false,error:item?.blockedReason||'O serviço mudou. Atualize a lista.'};
    const token=`fixture-service-${++performanceSequence}`;performanceTokens.set(token,{kind:'service',id,dryRun:model.dryRun});
    return{ok:true,token,id,label:item.label,dryRun:model.dryRun};
  },
  unloadService:async consent=>{
    record('unloadService',consent);const prepared=performanceTokens.get(consent.token);performanceTokens.delete(consent.token);
    if(!prepared||prepared.kind!=='service'||prepared.id!==consent.id)return{ok:false,error:'Confirmação inválida. Atualize a lista.'};
    if(prepared.dryRun!==model.dryRun||consent.expectedDryRun!==model.dryRun)return{ok:false,error:'O modo de simulação mudou. Revise o serviço novamente.'};
    if(model.unloadServiceError)return{ok:false,error:'Não foi possível descarregar o serviço.'};
    if(!model.dryRun)model.performance.services=model.performance.services.filter(item=>item.id!==consent.id);
    return{ok:true,simulated:model.dryRun};
  },
  getSchedule:async()=>clone(model.schedule),setSchedule:async patch=>{record('setSchedule',patch);if(model.scheduleError)throw Error('Falha de agendamento simulada.');model.schedule={...model.schedule,...patch};return clone(model.schedule);},
  checkUpdates:async()=>{record('checkUpdates');if(model.updateError)throw Error('Sem conexão.');return clone(model.updates);},installUpdate:async()=>{record('installUpdate');emit('updateProgress',{phase:'download',percent:42});await wait(10);return model.downloadError?{ok:false,error:'A verificação de segurança (SHA-256) falhou. Nada foi instalado.'}:{ok:true};},onUpdateProgress:listen('updateProgress'),onUpdates:listen('updates'),
  setAppearance:async appearance=>{record('setAppearance',appearance);if(model.appearanceError)return{ok:false,appearance:model.appearance,colorScheme:model.colorScheme,error:'Falha ao salvar aparência.'};model.appearance=appearance;model.colorScheme=appearance==='noturno'?'dark':'light';const out={ok:true,appearance,colorScheme:model.colorScheme};emit('appearance',out);return out;},onAppearance:listen('appearance'),
  openPhotos:async()=>{record('openPhotos');if(model.photoOpenError)throw Error('Janela indisponível no teste.');return {ok:true};},onPhotosChanged:listen('photosChanged'),
  openPrivacy:permission=>record('openPrivacy',permission),openAccount:async()=>{record('openAccount');return{ok:true};},openSite:()=>record('openSite'),quit:()=>record('quit'),hide:()=>record('hide'),onShown:listen('shown'),onHidden:listen('hidden'),onEscape:listen('escape'),
};
const photoRoots={photos:[{id:'pictures',label:'Imagens',path:'/fixture/Pictures'},{id:'downloads',label:'Downloads',path:'/fixture/Downloads'}],files:[{id:'downloads',label:'Downloads',path:'/fixture/Downloads'},{id:'documents',label:'Documentos',path:'/fixture/Documents'}]};
const makeFile=(id,name,bytes,root='Pictures',kind)=>({id,name,bytes,path:`/fixture/${root}/${name}`,modifiedAt:'2026-11-01T12:00:00.000Z',kind,extension:name.split('.').pop()});
const photoGroups={
  photos:[{id:'photo-group-a',files:[makeFile('pa','Praia.jpg',6.4e6),makeFile('pb','Praia — cópia.jpg',6.4e6),makeFile('pc','Praia.jpg',6.4e6,'Downloads')]},{id:'photo-group-b',files:[makeFile('pd','Montanhas.jpg',4.2e6),makeFile('pe','Montanhas — cópia.jpg',4.2e6,'Downloads')]}],
  files:[{id:'file-group-a',files:[makeFile('fa','Apresentação.mp4',184e6,'Downloads','video'),makeFile('fb','Apresentação — cópia.mp4',184e6,'Downloads','video')]},{id:'file-group-b',files:[makeFile('fc','Relatório.pdf',2.8e6,'Downloads','document'),makeFile('fd','Relatório (1).pdf',2.8e6,'Downloads','document')]},{id:'file-group-c',files:[makeFile('fe','Música.m4a',9.6e6,'Downloads','audio'),makeFile('ff','Música — cópia.m4a',9.6e6,'Downloads','audio')]},{id:'file-group-d',files:[makeFile('fg','Materiais.zip',24e6,'Downloads','archive'),makeFile('fh','Materiais — cópia.zip',24e6,'Downloads','archive')]}],
};
const photoModel={dryRun:true,scanDelay:50,scanError:false,scanCancelled:false,empty:false,addFolderCancelled:false,trashError:false,partial:false,thumbnailUnsafe:false,roots:clone(photoRoots),snapshots:{}};
let scanCancelled=false;
const snapshot=(mode,rootIds)=>({mode,scanId:`fixture-${mode}`,rootIds,groups:photoModel.empty||scanCancelled?[]:clone(photoGroups[mode]),cancelled:scanCancelled,stats:{errors:[]}});
const photoApi={
  taskComplete:async()=>{record('photo.taskComplete');return{ok:true};},
  init:async(mode='photos')=>{record('photo.init',mode);return{mode,dryRun:photoModel.dryRun,demo:true,roots:clone(photoModel.roots[mode]),snapshot:clone(photoModel.snapshots[mode]||{groups:[]}),appearance:model.appearance,colorScheme:model.colorScheme};},
  addFolder:async mode=>{record('photo.addFolder',mode);if(photoModel.addFolderCancelled)return{cancelled:true};const root={id:'extra',label:'Pasta de exemplo',path:'/fixture/Extra'};photoModel.roots[mode].push(root);return{ok:true,root};},
  scan:async(rootIds,mode)=>{record('photo.scan',rootIds,mode);scanCancelled=false;emit('photoProgress',{mode,phase:'walking',photos:5,files:8});await wait(photoModel.scanDelay);if(photoModel.scanError)throw Error('Falha de busca simulada.');const result=snapshot(mode,rootIds);photoModel.snapshots[mode]=result;return clone(result);},
  cancel:async mode=>{record('photo.cancel',mode);scanCancelled=true;return{ok:true};},
  thumbnail:async(id,mode)=>{record('photo.thumbnail',id,mode);return photoModel.thumbnailUnsafe?{dataUrl:'javascript:alert(1)'}:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};},
  reveal:async(id,mode)=>{record('photo.reveal',id,mode);return{ok:true};},
  trash:async consent=>{record('photo.trash',consent);if(photoModel.trashError)return{ok:false,error:'Modo mudou. Analise novamente.'};const result=consent.ids.map((id,i)=>({id,name:id,status:photoModel.partial&&i===0?'skipped':photoModel.dryRun?'simulated':'moved',reason:photoModel.partial&&i===0?'Arquivo alterado desde a busca.':''}));return{ok:true,dryRun:photoModel.dryRun,results:result,moved:result.filter(r=>r.status==='moved'),simulated:result.filter(r=>r.status==='simulated'),skipped:result.filter(r=>r.status==='skipped')};},
  openPhotos:async()=>{record('photo.openPhotos');return{ok:true};},onProgress:listen('photoProgress'),onAppearance:listen('appearance'),
};
contextBridge.exposeInMainWorld('limpa',mainApi);
contextBridge.exposeInMainWorld('photos',photoApi);
contextBridge.exposeInMainWorld('__uiTest',{
  calls:()=>clone(calls),clear:()=>{calls.length=0;},get:()=>clone(model),photos:()=>clone(photoModel),
  performanceMetricsStats:()=>clone(performanceMetricStats),
  patch:value=>Object.assign(model,clone(value)),patchPhotos:value=>Object.assign(photoModel,clone(value)),
  analysis:(id,value)=>{model.analyses[id]={...model.analyses[id],...clone(value)};},emit,
});
