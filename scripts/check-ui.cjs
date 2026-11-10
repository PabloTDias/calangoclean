// Exercises the shipping HTML/CSS/renderers with a fixture-only preload.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/check-ui.cjs
// This deliberately does not load src/main.js or the production preload.
const { app, BrowserWindow, nativeTheme, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const output = path.resolve(ROOT,'output','validation','painel-discos-0.4.4');
const temp = syncFs.mkdtempSync(path.join(os.tmpdir(),'calangoclean-ui-check-'));
app.setPath('userData',temp);
app.setName('CalangoClean — testes isolados');
app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('disable-background-networking');
const results=[];
const errors=[];
const windows=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let current;
async function evaluate(code){return current.webContents.executeJavaScript(code,true);}
async function waitFor(code, timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(`Boolean(${code})`).catch(()=>false))return;await delay(25);}throw Error(`Tempo excedido: ${code}`);}
async function check(name,code){let actual;try{actual=await evaluate(code);assert.equal(actual,true);results.push({name,status:'pass'});}catch(error){results.push({name,status:'fail',actual,error:error.message});}console.log(`${results.at(-1).status==='pass'?'PASS':'FAIL'} ${name}`);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const change=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const input=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const patch=value=>evaluate(`window.__uiTest.patch(${JSON.stringify(value)})`);
const photoPatch=value=>evaluate(`window.__uiTest.patchPhotos(${JSON.stringify(value)})`);
const analysis=(id,value)=>evaluate(`window.__uiTest.analysis(${JSON.stringify(id)},${JSON.stringify(value)})`);
const emit=(name,value)=>evaluate(`window.__uiTest.emit(${JSON.stringify(name)},${JSON.stringify(value??null)})`);
async function refresh(){await click('#refreshBtn');await waitFor('!document.getElementById("refreshBtn").disabled');}
async function view(name){await evaluate(`document.querySelector('[data-view="${name}"]')?.click()`);await delay(10);}
async function reloadPerformance(){await view('clean');await view('performance');await waitFor('document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="false"');}
async function screenshot(name){current.webContents.invalidate();await delay(350);await fs.writeFile(path.join(output,name+'.png'),(await current.webContents.capturePage()).toPNG());}
async function windowFor(file,width,height){
  const win=new BrowserWindow({show:false,width,height,webPreferences:{preload:path.join(ROOT,'tests','fixtures','ui-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true}});
  windows.push(win);current=win;
  win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('Content-Security-Policy'))errors.push({file,message:event.message});});
  await win.loadFile(path.join(ROOT,'ui',file));
  return win;
}
async function mainUi(){
  await windowFor('index.html',420,660);
  await waitFor('document.querySelectorAll(".cat").length===8&&!document.getElementById("refreshBtn").disabled');
  await check('Painel: todas as oito categorias e destaque WhatsApp',`document.querySelectorAll('.cat').length===8 && document.querySelector('#featured .cat[data-id="whatsapp"]')!==null`);
  await check('Painel: navegação preserva funções e inclui Apps e Desempenho',`['clean','apps','performance','devices','schedule','settings'].every(id=>document.querySelector('[data-view="'+id+'"]'))`);
  await check('Inicialização não inicia limpeza, busca de pastas, teste de rede ou coleta de processos',`!window.__uiTest.calls().some(c=>['clean','analyzeFolders','runSpeedTest','getPerformance'].includes(c.name))`);
  await check('Total inicial e seleção correspondem aos dados medidos',`document.getElementById('totalSel').textContent==='4,4 GB'&&!document.getElementById('cleanBtn').disabled`);
  await check('Botão Limpar mantém o fluxo de confirmação',`document.getElementById('ctaLabel').textContent==='Limpar'&&document.getElementById('confirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='clean')`);
  await click('#toggleAll');await delay(20);
  await check('Marcar tudo inclui as cinco categorias interativas',`document.querySelectorAll('.cat input:checked').length===5`);
  await click('#toggleAll');await delay(20);
  await check('Desmarcar tudo zera o total e bloqueia a limpeza',`document.querySelectorAll('.cat input:checked').length===0&&document.getElementById('totalSel').textContent==='0 B'&&document.getElementById('cleanBtn').disabled`);
  await click('#toggleAll');await delay(20);
  await click('#infoToggle');
  await check('Revisão manual mantém arquivos Finder e cinco sites',`document.querySelectorAll('[data-id="downloadsLarge"] .drow').length===2&&document.querySelectorAll('[data-id="chromeIndexedDB"] .drow').length===5&&!document.getElementById('infos').hidden`);
  await click('[data-id="downloadsLarge"] .drow button');await click('[data-id="whatsapp"] .cat-action');
  await check('Ações manuais passam por APIs explícitas sem limpar dados',`window.__uiTest.calls().some(c=>c.name==='reveal')&&window.__uiTest.calls().some(c=>c.name==='openCategory'&&c.args[0]==='whatsapp')&&!window.__uiTest.calls().some(c=>c.name==='clean')`);
  await analysis('whatsapp',{canOpen:false});await refresh();
  await check('WhatsApp não instalado oculta a ação Abrir',`document.querySelector('[data-id="whatsapp"] .cat-action').hidden`);
  await analysis('whatsapp',{canOpen:true});
  for(const days of [0,7,15,30]){await change('[data-id="trashOld"] select.days',String(days));await delay(30);await check(`Lixeira: prazo ${days===0?'Tudo':days+' dias'} remede e permanece selecionado`,`document.querySelector('[data-id="trashOld"] select.days').value==='${days}'&&window.__uiTest.calls().some(c=>c.name==='setTrashDays'&&c.args[0]===${days})&&document.querySelector('[data-id="trashOld"] input').checked`);}
  await analysis('trashOld',{bytes:0,settings:{days:7,eligibleCount:1}});
  for(const id of ['caches','logs','chromeServiceWorker','devCaches'])await analysis(id,{bytes:0});
  await refresh();
  await check('Lixeira com arquivo vazio elegível habilita ação em 0 B',`document.getElementById('totalSel').textContent==='0 B'&&!document.getElementById('cleanBtn').disabled&&[...document.querySelectorAll('.cat input')].every(e=>!e.disabled)`);
  await analysis('trashOld',{settings:{days:7,eligibleCount:1,measurementError:true,statusReason:'Medição incompleta.'}});await refresh();
  await check('Falha de medição exibe travessão e impede exclusão',`document.querySelector('[data-id="trashOld"] .cat-size').textContent==='—'&&document.getElementById('cleanBtn').disabled`);
  await analysis('chromeServiceWorker',{accessIssue:'Acesso Total ao Disco necessário.'});await refresh();
  await check('Permissão de disco mostra banner e tamanho desconhecido',`!document.getElementById('permBanner').hidden&&document.getElementById('permBanner').dataset.permission==='fullDisk'&&document.querySelector('[data-id="chromeServiceWorker"] .cat-size').textContent==='—'`);
  await click('#permBtn');
  await check('Dar acesso usa o destino de privacidade correto',`window.__uiTest.calls().some(c=>c.name==='openPrivacy'&&c.args[0]==='fullDisk')`);
  await analysis('chromeServiceWorker',{accessIssue:null,bytes:.64e9});
  await analysis('trashOld',{accessIssue:'Autorize o Finder.',settings:{days:0,eligibleCount:3,permissionKind:'automation'}});await refresh();
  await check('Autorização de Automação é diferenciada da permissão de disco',`document.getElementById('permBanner').dataset.permission==='automation'&&document.getElementById('permText').textContent.includes('Finder')`);
  await click('#permBtn');
  await analysis('trashOld',{accessIssue:null,bytes:2.4e9,settings:{days:0,eligibleCount:3}});await analysis('caches',{bytes:2.42e9});await refresh();
  await click('#cleanBtn');
  await check('Simulação: confirmação informa total e Tudo sem fechar navegadores',`!document.getElementById('confirm').hidden&&document.getElementById('confirmText').textContent.includes('Nada será apagado')&&document.getElementById('confirmBrowsers').hidden`);
  const cleanBefore=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='clean').length`);
  await click('#confirmCancel');
  await check('Cancelar confirmação não invoca limpeza',`window.__uiTest.calls().filter(c=>c.name==='clean').length===${cleanBefore}`);
  await click('#cleanBtn');await click('#confirmOk');await waitFor('!document.getElementById("cleanBtn").classList.contains("busy")');
  await check('Resultado simulado preserva informação nada apagado',`!document.getElementById('result').hidden&&document.getElementById('result').textContent.includes('nada apagado')&&window.__uiTest.calls().filter(c=>c.name==='clean').at(-1).args[1].expectedDryRun===true`);
  await click('#cleanBtn');await emit('photosChanged',null);await delay(30);
  await check('Revisão de duplicados invalida confirmação antiga da Lixeira',`document.getElementById('confirm').hidden`);
  await analysis('caches',{settings:{statusReason:'com.microsoft.VSCode.ShipIt: Não foi possível apagar este item (ENOTEMPTY).'}});await refresh();
  await check('Aviso de cache preservado usa linguagem simples e guarda diagnóstico no tooltip',`document.querySelector('[data-id="caches"] .cat-desc').textContent==='Alguns arquivos foram mantidos'&&!document.querySelector('[data-id="caches"] .cat-desc').textContent.includes('ENOTEMPTY')&&document.querySelector('[data-id="caches"]').dataset.tip.includes('ENOTEMPTY')`);
  await screenshot('limpeza-aviso-simples');await analysis('caches',{settings:null});
  await view('devices');
  await check('Discos rede e Bluetooth começam recolhidos sem iniciar medições',`document.getElementById('diskDetail').hidden&&document.getElementById('chipDetail').hidden&&document.getElementById('btDetails').hidden&&[...document.querySelectorAll('.device-volume-body')].every(e=>e.hidden)&&!window.__uiTest.calls().some(c=>['analyzeFolders','analyzeVolumeFolders','runSpeedTest'].includes(c.name))`);
  await screenshot('dispositivos-recolhidos');
  await click('#showBluetooth');
  await check('Bluetooth expande por clique e informa quantidade e bateria',`!document.getElementById('btDetails').hidden&&document.querySelectorAll('#btDetails li').length===4&&document.getElementById('showBluetooth').getAttribute('aria-expanded')==='true'`);
  await click('#showBluetooth');
  await click('#showFolders');await waitFor('document.querySelectorAll("#ddList li").length===7');
  await screenshot('dispositivos-expandidos');
  await check('Disco expande sete pastas e mantém indicação parcial',`document.querySelectorAll('#ddList li').length===7&&document.getElementById('ddList').textContent.includes('parcial')`);
  await click('#ddList .dd-reveal');
  await check('Mostrar pasta usa apenas ID permitido',`window.__uiTest.calls().some(c=>c.name==='revealFolder'&&c.args[0]==='apps')`);
  await patch({foldersDelay:150});await click('#ddRun');await click('#ddCancel');await delay(170);
  await check('Cancelar medição de pastas conserva o resultado anterior',`window.__uiTest.calls().some(c=>c.name==='cancelFolders')&&document.querySelectorAll('#ddList li').length===7&&!document.getElementById('ddRun').hidden`);
  await click('#deviceVolumes .device-fold-toggle');await waitFor('document.querySelectorAll("#deviceVolumes .external-legend li").length>0');
  await check('Clique no disco externo gera rosca e legenda por ID sem afetar o gráfico principal',`document.querySelector('#deviceVolumes .donut svg')!==null&&window.__uiTest.calls().filter(c=>c.name==='analyzeVolumeFolders').length===1&&document.querySelectorAll('#ddList li').length===7`);
  await screenshot('disco-externo-expandido');
  await click('#deviceVolumes .device-fold-toggle');await click('#deviceVolumes .device-fold-toggle');
  await check('Reabrir disco externo reutiliza o gráfico sem outra varredura',`window.__uiTest.calls().filter(c=>c.name==='analyzeVolumeFolders').length===1`);
  await click('#deviceVolumes .device-fold-toggle');
  await click('.chip[data-key="net"]');await click('#speedBtn');
  await check('Teste de rede só por clique e com progresso',`window.__uiTest.calls().filter(c=>c.name==='runSpeedTest').length===1&&!document.getElementById('speedProg').hidden`);
  await delay(70);
  await check('Rede mostra download upload e latência',`!document.getElementById('speedResult').hidden&&document.getElementById('spDown').textContent.includes('284,6')&&document.getElementById('spUp').textContent.includes('92,4')&&document.getElementById('spLat').textContent==='12 ms'`);
  await patch({speed:{ok:false,error:'Sem conexão de teste.'}});await click('#speedBtn');await delay(70);
  await check('Falha de rede não vira velocidade zero',`!document.getElementById('speedErr').hidden&&document.getElementById('speedErr').textContent==='Sem conexão de teste.'&&document.getElementById('speedResult').hidden`);
  await patch({ejectError:true});await click('.chip[data-key="disk-fixture"]');await click('#deviceVolumes .vol-eject');await delay(40);
  await check('Ejeção em uso exibe motivo e permite tentar de novo',`document.querySelector('#deviceVolumes .vol-err').textContent.includes('em uso')&&!document.querySelector('#deviceVolumes .vol-eject').disabled`);
  await emit('volumes',[]);await delay(20);
  await check('Remoção de volume fecha seu detalhe e preserva a rede',`!document.querySelector('.chip[data-key="disk-fixture"]')&&document.querySelector('.chip[data-key="net"]')!==null`);
  await check('Bluetooth contém bateria baixa e dispositivo sem leitura',`window.__uiTest.get().bluetooth.length===4&&(document.querySelector('.bt.low')!==null||document.querySelector('.bt-more')!==null)&&document.getElementById('chips').textContent.length>0`);
  await view('schedule');await change('#schedDay','6');await change('#schedTime','23:45');await click('#schedOn');await delay(30);
  await check('Agenda aceita sete dias e hora/minuto e só altera chaves explícitas',`document.querySelectorAll('#schedDay option').length===7&&document.getElementById('schedTime').value==='23:45'&&document.getElementById('schedDay').value==='6'&&window.__uiTest.calls().some(c=>c.name==='setSchedule'&&c.args[0].minute===45)`);
  await patch({scheduleError:true});await change('#schedDay','2');await delay(30);
  await check('Erro de agenda aparece e controles são reabilitados',`!document.getElementById('schedErr').hidden&&!document.getElementById('schedOn').disabled&&!document.getElementById('schedDay').disabled`);
  await view('settings');
  await check('Exibição e atualizações ficam nos Ajustes e Sair fica no topo como power',`document.getElementById('settingsView').contains(document.getElementById('appearanceSelect'))&&document.getElementById('settingsView').contains(document.getElementById('updateBanner'))&&document.querySelector('.top').contains(document.getElementById('quitBtn'))&&document.querySelectorAll('#quitBtn svg').length===1&&!document.querySelector('.utility-row [data-view]')&&!document.querySelector('.utility-row #quitBtn')`);
  await click('#updateCheck');await delay(30);
  await check('Atualizações informa versão atual sem falso download',`document.getElementById('updateStatus').textContent.includes('mais recente')`);
  await patch({updates:{current:'0.4.2',available:{version:'0.4.3',url:'https://github.com/PabloTDias/calangoclean/releases/download/v0.4.3/test.dmg',sha256:'a'.repeat(64),size:1,name:'CalangoClean.dmg'},error:null}});await click('#updateCheck');await delay(30);
  await check('Nova versão exibe banner e botão Atualizar',`!document.getElementById('updateBanner').hidden&&document.getElementById('updateText').textContent.includes('Nova versão 0.4.3')&&document.getElementById('updateInstall').textContent==='Atualizar'`);
  await patch({downloadError:true});await click('#updateInstall');await delay(60);
  await check('Falha na atualização mostra o erro, mantém o banner e permite tentar de novo',`document.getElementById('updateText').textContent.includes('SHA-256')&&document.getElementById('updateInstall').textContent==='Tentar de novo'&&!document.getElementById('updateInstall').disabled&&document.getElementById('updateProgress').hidden`);
  for(const [mode,scheme] of [['normal','light'],['noturno','dark'],['automatico','light']]){await change('#appearanceSelect',mode);await delay(80);await check(`Aparência ${mode} aplica seletor e esquema`,`document.getElementById('appearanceSelect').value==='${mode}'&&getComputedStyle(document.documentElement).colorScheme.includes('${scheme}')`);console.log('SURFACES',mode,await evaluate(`JSON.stringify(['#disk','.chip','.ghost','.cats'].map(s=>({s,bg:getComputedStyle(document.querySelector(s)).backgroundColor,fg:getComputedStyle(document.querySelector(s)).color,scheme:getComputedStyle(document.querySelector(s)).colorScheme})))`));}
  await emit('appearance',{appearance:'automatico',colorScheme:'dark'});await delay(20);
  await check('Automático reage ao evento de aparência do sistema',`document.getElementById('appearanceSelect').value==='automatico'&&getComputedStyle(document.documentElement).colorScheme.includes('dark')`);
  await patch({appearanceError:true});await change('#appearanceSelect','noturno');await delay(30);
  await check('Erro ao salvar tema restaura preferência anterior e informa falha',`document.getElementById('appearanceSelect').value==='automatico'&&!document.getElementById('appStatus').hidden&&document.getElementById('appStatusText').textContent.includes('Falha ao salvar')&&!document.getElementById('appearanceSelect').disabled`);
  await patch({appearanceError:false});await click('#appStatusClose');
  await click('#accountBtn');
  await check('Login Seja Calango é opcional e abre somente por pedido',`window.__uiTest.calls().filter(c=>c.name==='openAccount').length===1&&document.getElementById('accountBtn').textContent.includes('Entrar')`);
  await change('#appearanceSelect','normal');nativeTheme.themeSource='light';await view('clean');await click('#infoToggle');
  await screenshot('painel-normal');
  await change('#appearanceSelect','noturno');nativeTheme.themeSource='dark';await screenshot('painel-noturno');
  await check('Modo noturno mantém superfícies com fundo escuro',`['#disk','.chip','.ghost','.cats'].every(s=>getComputedStyle(document.querySelector(s)).backgroundColor==='rgb(41, 46, 42)')`);
  for(const [width,height] of [[420,660],[320,568],[420,520]]){
    current.setSize(width,height);await delay(60);
    await check(`Painel ${width}x${height}: sem overflow horizontal e botões principais visíveis`,`document.documentElement.scrollWidth<=innerWidth&&(()=>{const r=document.getElementById('cleanBtn').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0&&r.right<=innerWidth;})()`);
  }
  await current.close();
  // A separate fixture-mode window verifies real browser-closing consent text.
  nativeTheme.themeSource='light';
  await windowFor('index.html',420,660);await waitFor('document.querySelectorAll(".cat").length===8');
  await evaluate(`state.dryRun=false`);await patch({dryRun:false,cleanPartial:true});
  await analysis('chromeServiceWorker',{blockedReason:'Chrome aberto',settings:{runningBrowsers:[{id:'chrome',name:'Google Chrome'}]}});await refresh();
  await click('#cleanBtn');
  await check('Limpeza real simulada pede consentimento explícito para fechar navegador',`!document.getElementById('confirmBrowsers').hidden&&document.getElementById('confirmBrowsers').textContent.includes('Salve seu trabalho')&&document.getElementById('confirmOk').textContent==='Fechar e limpar'`);
  await check('Alternativa informa limpeza sem fechar navegadores',`!document.getElementById('confirmSkipBrowser').hidden&&document.getElementById('confirmSkipBrowser').textContent.includes('Limpar sem fechar navegadores')`);
  await check('Confirmação de limpeza mantém foco no diálogo e impede interação ao fundo',`(()=>{const e=document.getElementById('confirmOk');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));const wrapped=document.activeElement.id==='confirmCancel';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));return wrapped&&document.activeElement.id==='confirmOk'&&[...document.querySelector('.app').children].filter(e=>e.id!=='confirm').every(e=>e.inert);})()`);
  await screenshot('confirmacao-navegadores');
  const beforeBrowserCancel=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='clean').length`);
  await click('#confirmCancel');
  await check('Fechar a confirmação de navegadores continua cancelando a operação',`document.getElementById('confirm').hidden&&window.__uiTest.calls().filter(c=>c.name==='clean').length===${beforeBrowserCancel}`);
  await click('#cleanBtn');await click('#confirmSkipBrowser');await delay(60);
  await check('Limpar sem fechar navegadores executa demais categorias com consentimento explícito',`(()=>{const c=window.__uiTest.calls().filter(c=>c.name==='clean').at(-1);return c&&c.args[0].includes('caches')&&c.args[0].includes('trashOld')&&!c.args[0].includes('chromeServiceWorker')&&c.args[1].closeBrowsers===false&&c.args[1].skipBrowsers===true&&c.args[1].expectedDryRun===false;})()`);
  await check('Alternativa conclui a operação e mantém a opção do cache para a próxima limpeza',`!document.getElementById('result').hidden&&!document.getElementById('cleanBtn').classList.contains('busy')&&document.querySelector('[data-id="chromeServiceWorker"] input').checked`);
  // The production main process intercepts Escape and forwards it through IPC.
  await click('#cleanBtn');await emit('escape',null);
  await check('Escape fecha a confirmação sem iniciar uma nova limpeza',`document.getElementById('confirm').hidden&&window.__uiTest.calls().filter(c=>c.name==='clean').length===${beforeBrowserCancel+1}`);
  await click('#cleanBtn');
  await click('#confirmOk');await delay(50);
  await check('Resultado parcial mantém nome/motivo e estado incompleto',`document.getElementById('result').textContent.includes('Limpeza incompleta')&&document.getElementById('result').textContent.includes('bloqueado.pdf')&&window.__uiTest.calls().some(c=>c.name==='clean'&&c.args[1].closeBrowsers===true)`);
  await patch({categoryError:true});const original=await evaluate(`document.querySelector('[data-id="caches"] input').checked`);await click('[data-id="caches"] input');await delay(40);
  await check('Falha ao salvar categoria não deixa seleção falsa persistida',`document.querySelector('[data-id="caches"] input').checked===${original}`);
  await current.close();
}
async function applicationsUi(){
  nativeTheme.themeSource='light';
  await windowFor('index.html',420,660);await waitFor('document.querySelectorAll(".cat").length===8');
  await view('apps');await waitFor('document.getElementById("appsRefresh")');
  await click('#appsRefresh');await waitFor('document.querySelectorAll("#appsList [data-app-id]").length===3');
  await check('Apps lista os aplicativos sem iniciar desinstalação',`document.querySelectorAll('#appsList [data-app-id]').length===3&&!window.__uiTest.calls().some(c=>c.name==='uninstallApp')&&document.getElementById('appsPrepare').disabled`);
  await check('Apps mostra o ícone recebido e mantém fallback nos demais',`document.querySelector('[data-app-id="app-editor"] img')?.naturalWidth>0&&!document.querySelector('[data-app-id="app-protected"] img')`);
  await check('Apps mostra tempo sem uso e não inventa histórico ausente',`document.querySelector('[data-app-id="app-editor"]').textContent.includes('Sem uso há 42 dias')&&document.querySelector('[data-app-id="app-protected"]').textContent.includes('Último uso não informado')&&document.querySelector('[data-app-id="app-running"]').textContent.includes('Em uso agora')`);
  await check('Apps ordena por nome mesmo quando a API envia fora de ordem',`[...document.querySelectorAll('#appsList [data-app-id]')].map(row=>row.dataset.appId).join(',')==='app-protected,app-running,app-editor'&&document.getElementById('appsCount').textContent.includes('Nome (A–Z)')`);
  await input('#appsSearch','editor');
  await check('Busca de aplicativos filtra pelo nome',`document.querySelectorAll('#appsList [data-app-id]').length===1&&document.querySelector('#appsList [data-app-id]').textContent.includes('Editor de exemplo')`);
  await input('#appsSearch','não existe');
  await check('Busca sem correspondências não permite desinstalar',`document.querySelectorAll('#appsList [data-app-id]').length===0&&document.getElementById('appsPrepare').disabled`);
  await input('#appsSearch','');await click('[data-app-id="app-running"]');
  await check('Aplicativo em uso mostra motivo e bloqueia a desinstalação',`document.getElementById('appsPrepare').disabled&&document.getElementById('appsView').textContent.includes('Feche o aplicativo')`);
  await click('[data-app-id="app-protected"]');
  await check('Aplicativo protegido permanece bloqueado para desinstalar',`document.getElementById('appsPrepare').disabled&&document.getElementById('appsView').textContent.includes('protegido do sistema')`);
  await check('Tamanho de aplicativo ainda não medido não é mostrado como zero',`document.getElementById('appsDetail').textContent.includes('Tamanho ao revisar')&&!document.getElementById('appsDetail').textContent.includes('0 B')`);
  await click('[data-app-id="app-editor"]');await click('#appsReveal');
  await check('Seleção habilita revisão e Finder usa somente ID permitido',`!document.getElementById('appsPrepare').disabled&&window.__uiTest.calls().some(c=>c.name==='revealApplication'&&c.args[0]==='app-editor')`);
  await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');
  await check('Desinstalação exige revisão do app e confirmação com cancelar em foco',`document.getElementById('appsConfirm').textContent.includes('Editor de exemplo')&&document.activeElement.id==='appsCancel'&&!window.__uiTest.calls().some(c=>c.name==='uninstallApp')`);
  await check('Confirmação do app mantém Tab no diálogo e bloqueia o painel de fundo',`(()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));const wrapped=document.activeElement.id==='appsConfirmAction';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return wrapped&&document.activeElement.id==='appsCancel'&&document.querySelector('.app').inert;})()`);
  await screenshot('aplicativos-confirmacao');
  await click('#appsCancel');
  await check('Cancelar revisão de aplicativo mantém lista e não desinstala',`document.getElementById('appsConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='uninstallApp')&&document.querySelector('[data-app-id="app-editor"]')!==null`);
  await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');await emit('escape',null);
  await check('Escape cancela a revisão do aplicativo sem ocultar o painel',`document.getElementById('appsConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='uninstallApp')&&!window.__uiTest.calls().some(c=>c.name==='hide')`);
  await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');await click('#appsConfirmAction');await delay(50);
  await check('Desinstalação simulada passa token e modo e preserva o app',`(()=>{const c=window.__uiTest.calls().filter(c=>c.name==='uninstallApp').at(-1);return c&&c.args[0].id==='app-editor'&&c.args[0].token.startsWith('fixture-uninstall-')&&c.args[0].expectedDryRun===true&&document.querySelector('[data-app-id="app-editor"]')!==null&&/simul|não foi removido|nada foi/i.test(document.getElementById('appsStatus').textContent);})()`);
  await click('[data-app-id="app-editor"]');await patch({prepareUninstallError:true});await click('#appsPrepare');await delay(40);
  await check('App que entrou em uso antes da revisão mostra erro sem autorizar remoção',`document.getElementById('appsConfirm').hidden&&document.getElementById('appsStatus').textContent.includes('em uso')&&!document.getElementById('appsPrepare').disabled`);
  await patch({prepareUninstallError:false});await click('[data-app-id="app-editor"]');await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');await patch({uninstallError:true});await click('#appsConfirmAction');await delay(50);
  await check('App que entrou em uso após revisão é preservado com motivo explícito',`document.getElementById('appsConfirm').hidden&&document.getElementById('appsStatus').textContent.includes('em uso')&&document.querySelector('[data-app-id="app-editor"]')!==null`);
  await patch({uninstallError:false});await click('[data-app-id="app-editor"]');await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');
  await patch({dryRun:false});await click('#appsConfirmAction');await delay(50);
  await check('Mudança de modo rejeita a confirmação antiga de desinstalação',`document.getElementById('appsConfirm').hidden&&document.getElementById('appsStatus').textContent.includes('modo de limpeza mudou')&&document.querySelector('[data-app-id="app-editor"]')!==null&&window.__uiTest.calls().filter(c=>c.name==='uninstallApp').at(-1).args[0].expectedDryRun===true`);
  const oldToken=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='uninstallApp').at(-1).args[0].token`);
  await patch({dryRun:true});await click('[data-app-id="app-editor"]');await click('#appsPrepare');await waitFor('!document.getElementById("appsConfirm").hidden');
  await click('#appsConfirmAction');await delay(50);
  await check('Nova revisão depois da mudança de modo usa novo token e simula normalmente',`(()=>{const c=window.__uiTest.calls().filter(c=>c.name==='uninstallApp').at(-1);return c.args[0].token!==${JSON.stringify(oldToken)}&&c.args[0].expectedDryRun===true&&/simul|não foi removido|nada foi/i.test(document.getElementById('appsStatus').textContent);})()`);
  await patch({applicationsError:true});await click('#appsRefresh');await delay(40);
  await check('Erro ao listar aplicativos aparece e libera nova tentativa',`document.getElementById('appsStatus').textContent.includes('Não foi possível listar')&&!document.getElementById('appsRefresh').disabled`);
  await patch({applicationsError:false});await click('#appsRefresh');await waitFor('document.querySelectorAll("#appsList [data-app-id]").length===3');await click('[data-app-id="app-editor"]');
  await patch({prepareUninstallDelay:100});await click('#appsPrepare');await view('clean');await delay(130);
  await check('Sair de Apps durante a revisão descarta resposta e não abre modal tardio',`document.getElementById('appsConfirm').hidden&&document.getElementById('appsView').hidden&&document.querySelector('[data-view="clean"]').getAttribute('aria-current')==='page'`);
  await view('apps');await waitFor('!document.getElementById("appsPrepare").disabled');await click('#appsPrepare');await emit('escape',null);await delay(130);
  await check('Escape durante revisão pendente descarta resposta sem ocultar o painel',`document.getElementById('appsConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='hide')&&!document.getElementById('appsPrepare').disabled`);
  await patch({prepareUninstallDelay:0});
  await screenshot('aplicativos-normal');
  await change('#appearanceSelect','noturno');nativeTheme.themeSource='dark';await screenshot('aplicativos-noturno');
  current.setSize(320,568);await delay(60);
  await check('Aplicativos no painel compacto mantém conteúdo e navegação legíveis sem overflow',`document.documentElement.scrollWidth<=innerWidth&&document.getElementById('appsRefresh').getBoundingClientRect().right<=innerWidth&&[...document.querySelectorAll('.panel-nav button')].every(e=>e.scrollWidth<=e.clientWidth)`);
  await screenshot('aplicativos-compacto');
  await evaluate(`window.__uiTest.patch({applications:Array.from({length:35},(_,i)=>({id:'many-'+i,name:'Aplicativo '+String(i+1).padStart(2,'0'),version:'1.0',bytes:null,canUninstall:true,running:false,lastUsedAt:i?null:new Date(Date.now()-90*86400000).toISOString()}))})`);
  await click('#appsRefresh');await waitFor('document.querySelectorAll("#appsList [data-app-id]").length===35');
  await check('Lista longa usa rolagem da página e mantém todos os aplicativos disponíveis',`document.getElementById('scroll').scrollHeight>document.getElementById('scroll').clientHeight&&document.querySelectorAll('#appsList [data-app-id]').length===35&&getComputedStyle(document.getElementById('appsList')).maxHeight==='none'`);
  await evaluate(`document.getElementById('scroll').scrollTop=document.getElementById('scroll').scrollHeight`);await delay(50);
  await check('Rolagem alcança o último aplicativo sem cortar o rodapé',`document.querySelector('[data-app-id="many-34"]').getBoundingClientRect().bottom<=innerHeight&&document.querySelector('.utility-row').getBoundingClientRect().bottom<=innerHeight`);
  await screenshot('apps-lista-completa');
  await current.close();
}
async function performanceUi(){
  nativeTheme.themeSource='light';
  await windowFor('index.html',420,660);
  await waitFor('document.querySelectorAll(".cat").length===8');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});true;`);
  await check('Desempenho não coleta processos durante a inicialização',`!window.__uiTest.calls().some(c=>c.name==='getPerformance')`);
  await view('performance');
  await waitFor('document.querySelectorAll("#performanceProcesses [data-process-pid]").length===2');
  await check('Abrir Desempenho faz uma única leitura sob demanda',`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1&&!window.__uiTest.calls().some(c=>['terminateProcess','unloadService'].includes(c.name))`);
  await check('Apps mostram CPU memória tempo aberto contagem de processos e ícone',`(()=>{const row=document.querySelector('[data-process-pid="4101"]');return row.textContent.includes('Editor de exemplo')&&row.textContent.includes('18,4')&&row.textContent.includes('640')&&row.textContent.includes('3 processos')&&row.textContent.includes('1 h 2 min')&&row.querySelector('img')?.naturalWidth>0;})()`);
  await check('Grade usa X compacto com nome acessível e não tem botão Atualizar',`!document.getElementById('performanceRefresh')&&[...document.querySelectorAll('#performanceProcesses button[data-action]')].every(button=>button.textContent==='×'&&button.getAttribute('aria-label').includes('Encerrar')&&button.getBoundingClientRect().width<=28)`);
  await check('Pressão de memória usa a leitura do macOS',`document.getElementById('performancePressure').dataset.level==='normal'&&document.getElementById('performancePressureDetail').textContent.includes('42')`);
  await check('Marcadores usam CPU total e RAM física sem somar processos ou inverter a pressão',`(()=>{const cpu=document.getElementById('performanceCpuGauge'),memory=document.getElementById('performanceMemoryGauge');return cpu?.getAttribute('role')==='meter'&&memory?.getAttribute('role')==='meter'&&cpu.dataset.state==='ready'&&memory.dataset.state==='ready'&&Number(cpu.getAttribute('aria-valuenow'))===27.5&&Number(memory.getAttribute('aria-valuenow'))===75&&cpu.querySelector('.performance-gauge-value').textContent==='27,5%'&&memory.querySelector('.performance-gauge-value').textContent==='75%';})()`);
  await check('Marcadores têm escala acessível segmentos coloridos e ponteiros nas posições lidas',`['performanceCpuGauge','performanceMemoryGauge'].every((id,index)=>{const gauge=document.getElementById(id),needle=gauge.querySelector('.performance-gauge-needle'),segments=[...gauge.querySelectorAll('.performance-gauge-segment')];return gauge.getAttribute('aria-valuemin')==='0'&&gauge.getAttribute('aria-valuemax')==='100'&&Number(needle.getAttribute('transform')?.match(/rotate\\(([-\\d.]+)/)?.[1])===[49.5,135][index]&&!needle.hasAttribute('hidden')&&segments.length===10&&segments.some(segment=>segment.dataset.filled==='true')&&segments.some(segment=>segment.dataset.filled==='false');})`);
  await check('App agrupado ocupa uma linha e informa seus processos',`(()=>{const row=document.querySelector('[data-process-pid="4101"]');return document.querySelectorAll('[data-process-pid="4101"]').length===1&&/3 processos/.test(row.textContent)&&!document.querySelector('[data-process-pid="4111"]')&&!document.querySelector('[data-process-pid="4112"]');})()`);
  await check('Grid mostra barra de memória relativa à RAM física com valor e escala acessível',`(()=>{const row=document.querySelector('[data-process-pid="4101"]'),bar=row.querySelector('.performance-memory-bar');return bar?.getAttribute('role')==='meter'&&Number(bar.getAttribute('aria-valuenow'))===4&&bar.getAttribute('aria-valuemin')==='0'&&bar.getAttribute('aria-valuemax')==='100'&&row.querySelector('.performance-memory').textContent.includes('640')&&row.querySelector('.performance-memory').textContent.includes('4%');})()`);
  await check('Históricos de CPU e memória aparecem junto dos marcadores',`['performanceCpuChart','performanceMemoryChart'].every(id=>{const chart=document.getElementById(id);return chart&&chart.querySelector('svg')&&chart.textContent.trim().length>0;})`);
  await screenshot('marcadores-normal');
  await change('#appearanceSelect','noturno');nativeTheme.themeSource='dark';await screenshot('marcadores-noturno');
  current.setSize(320,568);await delay(60);
  await check('Marcadores no painel compacto mantêm os valores visíveis sem overflow',`document.documentElement.scrollWidth<=innerWidth&&['performanceCpuGauge','performanceMemoryGauge'].every(id=>{const gauge=document.getElementById(id),value=gauge.querySelector('.performance-gauge-value'),rect=gauge.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&value.scrollWidth<=value.clientWidth;})`);
  await screenshot('marcadores-compacto');
  current.setSize(420,660);await change('#appearanceSelect','normal');nativeTheme.themeSource='light';await delay(60);
  await check('Desempenho exibe apenas processos que podem ser encerrados',`!document.querySelector('[data-process-pid="4103"]')&&!document.querySelector('[data-action="force"]')&&document.querySelectorAll('#performanceProcesses [data-action="terminate"]').length===2`);
  await check('Serviços protegidos também ficam fora da lista de ações',`document.querySelectorAll('#performanceServices [data-service-id]').length===1&&document.querySelector('[data-service-id="service-example"] [data-action="unload"]')!==null&&!document.querySelector('[data-service-id="service-protected"]')`);
  await check('Ordem inicial prioriza CPU',`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4102'`);
  await click('#performanceSortName');
  await check('Cabeçalho Nome ordena sem combo coleta ou aviso sonoro adicional',`!document.getElementById('performanceSort')&&document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4101'&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1&&!window.__uiTest.calls().some(c=>c.name==='taskComplete')`);
  await click('#performanceSortName');
  await check('Segundo clique no cabeçalho inverte a ordem',`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4102'`);
  await click('#performanceSortCpu');
  await check('Cabeçalho CPU começa com maior consumo e permite inverter',`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4102'`);
  await click('#performanceSortCpu');
  await check('Cabeçalho CPU também ordena do menor para o maior',`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4101'`);
  await click('#performanceSortMemory');
  await check('Ordenar por memória não provoca uma nova coleta',`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4101'&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1`);
  await input('#performanceSearch','editor');
  await check('Busca filtra o snapshot sem consultar o sistema',`document.querySelectorAll('#performanceProcesses [data-process-pid]').length===1&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1`);
  await check('Busca e ordenação preservam a leitura dos marcadores sem coleta adicional',`document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='27.5'&&document.getElementById('performanceMemoryGauge').getAttribute('aria-valuenow')==='75'&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1`);
  await input('#performanceSearch','');
  await click('[data-process-pid="4101"] [data-action="terminate"]');
  await waitFor('!document.getElementById("performanceConfirm").hidden');
  await check('Encerrar exige confirmação com cancelar em foco',`document.getElementById('performanceConfirmName').textContent.includes('Editor de exemplo')&&document.activeElement.id==='performanceCancel'&&!window.__uiTest.calls().some(c=>c.name==='terminateProcess')`);
  await check('Revisão do app agrupado informa quantos processos serão encerrados',`document.getElementById('performanceConfirm').textContent.includes('3 processos')`);
  await check('Confirmação de processo prende o foco e desativa o fundo',`(()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));const wrapped=document.activeElement.id==='performanceConfirmOk';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return wrapped&&document.activeElement.id==='performanceCancel'&&document.querySelector('.app').inert;})()`);
  await click('#performanceCancel');
  await check('Cancelar processo não envia sinal',`document.getElementById('performanceConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='terminateProcess')`);
  await click('[data-process-pid="4101"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await emit('escape',null);
  await check('Escape cancela confirmação de processo sem ocultar o painel',`document.getElementById('performanceConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='terminateProcess')&&!window.__uiTest.calls().some(c=>c.name==='hide')`);
  await click('[data-process-pid="4101"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');
  await waitFor('document.getElementById("performanceConfirm").hidden&&!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await check('Simulação preserva processo e passa PID token e modo confirmados',`(()=>{const c=window.__uiTest.calls().filter(c=>c.name==='terminateProcess').at(-1);return c&&c.args[0].pid===4101&&c.args[0].token.startsWith('fixture-process-')&&c.args[0].expectedDryRun===true&&c.args[0].force===false&&document.querySelector('[data-process-pid="4101"]')!==null&&/simul/i.test(document.getElementById('performanceStatus').textContent)&&!document.querySelector('[data-action="force"]');})()`);
  await patch({prepareProcessError:true});await click('[data-process-pid="4101"] [data-action="terminate"]');await delay(40);
  await check('Falha na revisão do processo não abre confirmação nem bloqueia nova tentativa',`document.getElementById('performanceConfirm').hidden&&document.getElementById('performanceStatus').textContent.includes('mudou')&&!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")`);
  await patch({prepareProcessError:false});await click('[data-process-pid="4101"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await patch({dryRun:false});await click('#performanceConfirmOk');await delay(40);
  await check('Mudança de simulação rejeita confirmação anterior sem encerrar processo',`document.getElementById('performanceConfirm').hidden&&document.getElementById('performanceStatus').textContent.includes('modo de simulação mudou')&&document.querySelector('[data-process-pid="4101"]')!==null`);
  await click('[data-process-pid="4101"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');await delay(40);
  await check('Forçar encerramento só aparece depois da tentativa normal que não encerrou',`document.querySelector('[data-process-pid="4101"] [data-action="force"]')!==null&&window.__uiTest.calls().filter(c=>c.name==='terminateProcess').at(-1).args[0].force===false`);
  await click('[data-process-pid="4101"] [data-action="force"]');await waitFor('!document.getElementById("performanceConfirm").hidden');
  await check('Forçar exige nova confirmação e aviso de trabalho não salvo',`/forçar/i.test(document.getElementById('performanceConfirmTitle').textContent)&&/não salvo/i.test(document.getElementById('performanceConfirmWarning').textContent)&&document.activeElement.id==='performanceCancel'&&window.__uiTest.calls().filter(c=>c.name==='prepareProcess').at(-1).args[1].force===true`);
  await screenshot('desempenho-confirmacao-forcar');
  await click('#performanceConfirmOk');await delay(40);
  await check('Segundo passo confirma força e remove apenas o processo encerrado do snapshot',`window.__uiTest.calls().filter(c=>c.name==='terminateProcess').at(-1).args[0].force===true&&!document.querySelector('[data-process-pid="4101"]')&&document.querySelector('[data-process-pid="4102"]')!==null`);
  await patch({terminateProcessError:true});await click('[data-process-pid="4102"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');await delay(40);
  await check('Processo alterado após confirmar mantém linha e exibe o motivo',`document.querySelector('[data-process-pid="4102"]')!==null&&document.getElementById('performanceStatus').textContent.includes('mudou')&&!document.querySelector('[data-process-pid="4102"] [data-action="force"]')`);
  await patch({terminateProcessError:false,dryRun:true});await click('[data-service-id="service-example"] [data-action="unload"]');await waitFor('!document.getElementById("performanceConfirm").hidden');
  await check('Descarregar serviço exige confirmação identificando o serviço',`document.getElementById('performanceConfirmName').textContent.includes('com.exemplo.sincronizador')&&document.activeElement.id==='performanceCancel'&&!window.__uiTest.calls().some(c=>c.name==='unloadService')`);
  await click('#performanceCancel');
  await check('Cancelar serviço não chama o launchd',`!window.__uiTest.calls().some(c=>c.name==='unloadService')`);
  await click('[data-service-id="service-example"] [data-action="unload"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');await delay(40);
  await check('Serviço em simulação mantém o item e envia apenas ID token e modo',`(()=>{const c=window.__uiTest.calls().filter(c=>c.name==='unloadService').at(-1);return c&&c.args[0].id==='service-example'&&c.args[0].token.startsWith('fixture-service-')&&c.args[0].expectedDryRun===true&&document.querySelector('[data-service-id="service-example"]')!==null&&/simul/i.test(document.getElementById('performanceStatus').textContent);})()`);
  await patch({dryRun:false,unloadServiceError:true});await click('[data-service-id="service-example"] [data-action="unload"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');await delay(40);
  await check('Falha ao descarregar serviço preserva o item e informa o erro',`document.querySelector('[data-service-id="service-example"]')!==null&&document.getElementById('performanceStatus').textContent.includes('Não foi possível descarregar')`);
  await patch({unloadServiceError:false});await click('[data-service-id="service-example"] [data-action="unload"]');await waitFor('!document.getElementById("performanceConfirm").hidden');await click('#performanceConfirmOk');await delay(40);
  await check('Descarregar com sucesso retira somente o serviço confirmado e mantém protegidos no backend',`!document.querySelector('[data-service-id="service-example"]')&&!document.querySelector('[data-service-id="service-protected"]')&&window.__uiTest.get().performance.services.some(item=>item.id==='service-protected')`);
  await patch({prepareProcessDelay:120});await click('[data-process-pid="4102"] [data-action="terminate"]');await view('clean');await delay(150);
  await check('Sair de Desempenho descarta revisão pendente e impede diálogo tardio',`document.getElementById('performanceConfirm').hidden&&document.getElementById('performanceView').hidden`);
  const beforeHiddenRead=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length`);
  await emit('shown',null);await delay(100);
  await check('Reabrir o painel em outra aba não coleta processos em segundo plano',`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===${beforeHiddenRead}`);
  await view('performance');await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await check('Voltar à aba atualiza o snapshot sob demanda',`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===${beforeHiddenRead+1}`);
  await click('[data-process-pid="4102"] [data-action="terminate"]');await emit('escape',null);await delay(150);
  await check('Escape durante revisão pendente impede confirmação tardia',`document.getElementById('performanceConfirm').hidden&&!window.__uiTest.calls().some(c=>c.name==='hide')&&!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")`);
  await patch({prepareProcessDelay:0,performanceError:true});await reloadPerformance();await delay(40);
  await check('Erro na leitura de processos fica explícito e permite tentar novamente',`document.getElementById('performanceStatus').textContent.includes('Não foi possível ler')&&!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")`);
  await check('Falha na atualização remove números e ponteiros anteriores dos marcadores',`['performanceCpuGauge','performanceMemoryGauge'].every(id=>{const gauge=document.getElementById(id);return gauge.dataset.state==='unknown'&&!gauge.hasAttribute('aria-valuenow')&&gauge.querySelector('.performance-gauge-value').textContent==='—'&&gauge.querySelector('.performance-gauge-needle').hasAttribute('hidden')&&[...gauge.querySelectorAll('.performance-gauge-segment')].every(segment=>segment.dataset.filled==='false');})`);
  await evaluate(`window.__uiTest.patch({performanceError:false,performance:{...window.__uiTest.get().performance,memoryPressure:{level:'unknown',freePercent:null},pressureError:'Pressão de memória indisponível.',serviceError:'Não foi possível consultar os serviços.'}})`);
  await reloadPerformance();await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await check('Falha parcial não inventa pressão normal ou memória zero',`document.getElementById('performancePressure').dataset.level==='unknown'&&document.getElementById('performancePressureDetail').textContent.includes('indisponível')&&document.getElementById('performanceServiceError').textContent.includes('Não foi possível consultar')`);
  for(const [name,systemMetrics,cpuPercent,memoryPercent] of [
    ['CPU indisponível mantém a RAM válida',{cpuPercent:null,memoryUsedBytes:12e9,memoryTotalBytes:16e9},null,75],
    ['RAM sem total mantém a CPU válida',{cpuPercent:65,memoryUsedBytes:12e9,memoryTotalBytes:null},65,null],
    ['Números inválidos não viram leituras válidas',{cpuPercent:-1,memoryUsedBytes:17e9,memoryTotalBytes:16e9},null,null],
    ['Escala aceita CPU e memória em zero',{cpuPercent:0,memoryUsedBytes:0,memoryTotalBytes:16e9},0,0],
    ['Escala aceita CPU e memória em cem por cento',{cpuPercent:100,memoryUsedBytes:16e9,memoryTotalBytes:16e9},100,100],
    ['CPU acima da escala e RAM sem capacidade ficam indisponíveis',{cpuPercent:101,memoryUsedBytes:0,memoryTotalBytes:0},null,null],
    ['Ausência de métricas não reaproveita valores antigos',null,null,null],
  ]){
    await evaluate(`window.__uiTest.patch({performance:{...window.__uiTest.get().performance,systemMetrics:${JSON.stringify(systemMetrics)}}})`);
    await reloadPerformance();await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
    await check(name,`['performanceCpuGauge','performanceMemoryGauge'].every((id,index)=>{const expected=${JSON.stringify([cpuPercent,memoryPercent])}[index],gauge=document.getElementById(id),needle=gauge.querySelector('.performance-gauge-needle');return expected===null?gauge.dataset.state==='unknown'&&!gauge.hasAttribute('aria-valuenow')&&gauge.querySelector('.performance-gauge-value').textContent==='—'&&needle.hasAttribute('hidden'):gauge.dataset.state==='ready'&&gauge.hasAttribute('aria-valuenow')&&Number(gauge.getAttribute('aria-valuenow'))===expected&&!needle.hasAttribute('hidden')&&Number(needle.getAttribute('transform')?.match(/rotate\\(([-\\d.]+)/)?.[1])===expected*1.8;})`);
  }
  await check('Sem capacidade total a barra não inventa porcentagem mas preserva o valor residente',`(()=>{const row=document.querySelector('[data-process-pid="4102"]'),bar=row.querySelector('.performance-memory-bar');return !bar.hasAttribute('aria-valuenow')&&row.querySelector('.performance-memory').textContent.includes('240');})()`);
  await evaluate(`window.__uiTest.patch({performance:{...window.__uiTest.get().performance,systemMetrics:{cpuPercent:27.5,memoryUsedBytes:12e9,memoryTotalBytes:16e9}}})`);
  await evaluate(`window.__uiTest.patch({performance:{...window.__uiTest.get().performance,memoryPressure:{level:'warning',freePercent:12},pressureError:null,serviceError:null,processes:window.__uiTest.get().performance.processes.map(item=>item.pid===4102?{...item,name:'Render de exemplo com nome muito longo para verificar o painel compacto'}:item)}})`);
  await reloadPerformance();await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await screenshot('desempenho-normal');
  await change('#appearanceSelect','noturno');nativeTheme.themeSource='dark';await screenshot('desempenho-noturno');
  for(const [width,height] of [[420,660],[320,568],[420,520]]){
    current.setSize(width,height);await delay(60);
    await check(`Desempenho ${width}x${height}: sem overflow e controles acessíveis`,`document.documentElement.scrollWidth<=innerWidth&&document.getElementById('performanceSearch').getBoundingClientRect().right<=innerWidth&&[...document.querySelectorAll('.panel-nav button')].every(e=>e.scrollWidth<=e.clientWidth)`);
  }
  await screenshot('desempenho-compacto');
  await current.close();
}
async function performanceAutomaticUi(){
  nativeTheme.themeSource='light';
  await windowFor('index.html',420,660);
  await waitFor('document.querySelectorAll(".cat").length===8');
  // Offscreen test windows are hidden by Electron. Simulate the document lifecycle
  // in this isolated page so the shipping visibility guard is exercised normally.
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>Boolean(window.__performanceDocumentHidden)});window.__performanceDocumentHidden=false;`);
  await check('Marcadores automáticos não coletam métricas antes de abrir Desempenho',`!window.__uiTest.calls().some(c=>c.name==='getPerformanceMetrics')`);
  await view('performance');
  await waitFor('document.querySelectorAll("#performanceProcesses [data-process-pid]").length===2');
  await check('Abrir a aba usa a leitura completa inicial sem uma consulta automática antecipada',`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1&&!window.__uiTest.calls().some(c=>c.name==='getPerformanceMetrics')`);
  await input('#performanceSearch','editor');
  await evaluate(`window.__performanceFirstRow=document.querySelector('#performanceProcesses [data-process-pid]');window.__performanceChartBeforeUpdate=document.getElementById('performanceCpuChart').innerHTML;window.__uiTest.patch({performanceMetrics:{processes:window.__uiTest.get().performance.processes.map(item=>item.pid===4101?{...item,cpu:31.2,memoryBytes:1e9}:item),systemMetrics:{cpuPercent:64,memoryUsedBytes:10e9,memoryTotalBytes:20e9},memoryPressure:{level:'warning',freePercent:17},sampledAt:'2026-11-09T15:30:01.000Z'}});`);
  await waitFor(`window.__uiTest.calls().some(c=>c.name==='getPerformanceMetrics')&&document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='64'`);
  await check('A cada meio segundo CPU memória gráficos e pressão atualizam no mesmo ciclo preservando filtro foco e linha',`(()=>{const row=document.querySelector('[data-process-pid="4101"]');return document.getElementById('performanceMemoryGauge').getAttribute('aria-valuenow')==='50'&&document.getElementById('performancePressure').dataset.level==='warning'&&document.getElementById('performanceSearch').value==='editor'&&row===window.__performanceFirstRow&&row.querySelector('.performance-cpu').textContent.includes('31,2%')&&Number(row.querySelector('.performance-memory-bar').getAttribute('aria-valuenow'))===5&&document.getElementById('performanceCpuChart').innerHTML!==window.__performanceChartBeforeUpdate&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1&&!window.__uiTest.calls().some(c=>c.name==='taskComplete');})()`);
  await check('Gráficos mantêm mais de uma amostra real no histórico',`['performanceCpuChart','performanceMemoryChart'].every(id=>{const chart=document.getElementById(id);return Number(chart.dataset.samples)>=2&&chart.querySelector('.performance-chart-line').getAttribute('d').includes('L');})`);
  await waitFor(`window.__uiTest.performanceMetricsStats().started.length>=2`);
  await check('Atualizações automáticas respeitam o intervalo de meio segundo',`(()=>{const times=window.__uiTest.performanceMetricsStats().started;return times[1]-times[0]>=400&&times[1]-times[0]<1500;})()`);
  await input('#performanceSearch','4111');
  await check('Buscar PID auxiliar encontra o app agrupado',`document.querySelectorAll('#performanceProcesses [data-process-pid]').length===1&&document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4101'`);
  await input('#performanceSearch','');
  await click('#performanceSortMemory');
  await evaluate(`window.__performanceFocusedAction=document.querySelector('[data-process-pid="4101"] [data-action]');window.__performanceFocusedAction.focus();window.__uiTest.patch({performanceMetrics:{...window.__uiTest.get().performanceMetrics,processes:window.__uiTest.get().performance.processes.map(item=>item.pid===4102?{...item,cpu:6,memoryBytes:2e9}:item)}});`);
  await waitFor(`document.querySelector('#performanceProcesses [data-process-pid]').dataset.processPid==='4102'`);
  await check('Novos consumos reordenam pelo cabeçalho escolhido sem perder o app agrupado',`document.querySelectorAll('#performanceProcesses [data-process-pid]').length===2&&Number(document.querySelector('[data-process-pid="4102"] .performance-memory-bar').getAttribute('aria-valuenow'))===10&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1`);
  await check('Reordenar automaticamente preserva o foco na ação do mesmo app',`document.activeElement===window.__performanceFocusedAction&&document.activeElement.closest('[data-process-pid]').dataset.processPid==='4101'&&window.__performanceFocusedAction.isConnected`);
  await evaluate(`window.__performanceBeforeProcessError=window.__uiTest.get().performanceMetrics;window.__uiTest.patch({performanceMetrics:{...window.__performanceBeforeProcessError,processes:null,processError:'Não foi possível ler os processos.',systemMetrics:{cpuPercent:72,memoryUsedBytes:10e9,memoryTotalBytes:20e9},sampledAt:'2026-11-09T15:30:02.000Z'}});`);
  await waitFor(`document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='72'`);
  await check('Falha parcial preserva marcadores atuais e lista anterior explicitamente desatualizada',`document.getElementById('performanceMemoryGauge').getAttribute('aria-valuenow')==='50'&&document.querySelectorAll('#performanceProcesses [data-process-pid]').length===2&&document.querySelector('[data-process-pid="4102"] .performance-cpu').textContent==='6%'&&document.getElementById('performanceProcessFrame').dataset.stale==='true'&&!document.getElementById('performanceProcessError').hidden&&document.getElementById('performanceProcessError').textContent.includes('Lista desatualizada')&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===1`);
  await evaluate(`window.__uiTest.patch({performanceMetrics:{...window.__performanceBeforeProcessError,sampledAt:'2026-11-09T15:30:03.000Z'}});`);
  await waitFor(`document.getElementById('performanceProcessFrame').dataset.stale==='false'`);
  await check('Próxima leitura válida remove o aviso de lista desatualizada',`document.getElementById('performanceProcessError').hidden&&document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='64'`);
  await screenshot('desempenho-automatico-normal');
  await view('clean');
  const awayCount=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length`);
  await delay(1200);
  await check('Sair da aba interrompe a atualização automática',`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length===${awayCount}`);
  await view('performance');await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await input('#performanceSearch','');
  await click('[data-process-pid="4101"] [data-action="terminate"]');await waitFor('!document.getElementById("performanceConfirm").hidden');
  const consentCount=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length`);
  await delay(1200);
  await check('Confirmação de encerramento pausa os marcadores e mantém o token válido',`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length===${consentCount}&&!document.getElementById('performanceConfirm').hidden`);
  await click('#performanceConfirmOk');await waitFor('document.getElementById("performanceConfirm").hidden');
  await check('Confirmação continua funcionando após a pausa automática',`window.__uiTest.calls().filter(c=>c.name==='terminateProcess').length===1&&document.getElementById('performanceStatus').textContent.includes('Simulação concluída')&&document.querySelector('[data-process-pid="4101"]')!==null`);
  await patch({performanceMetricsError:true});
  await waitFor(`document.getElementById('performanceCpuGauge').dataset.state==='unknown'`);
  await check('Falha automática remove leituras antigas e preserva processos e controles',`document.getElementById('performanceMemoryGauge').dataset.state==='unknown'&&document.querySelectorAll('#performanceProcesses [data-process-pid]').length===2&&!document.getElementById('performanceSearch').disabled&&!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")`);
  const soundCount=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='taskComplete').length`);
  await patch({performanceMetricsError:false});
  await waitFor(`document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='64'`);
  await check('O próximo ciclo recupera uma falha automaticamente sem emitir som',`document.getElementById('performanceMemoryGauge').getAttribute('aria-valuenow')==='50'&&window.__uiTest.calls().filter(c=>c.name==='taskComplete').length===${soundCount}`);
  await patch({performanceMetricsDelay:1600,performanceMetrics:{systemMetrics:{cpuPercent:80,memoryUsedBytes:10e9,memoryTotalBytes:20e9},memoryPressure:{level:'warning',freePercent:17},sampledAt:'2026-11-09T15:30:01.500Z'}});
  await waitFor('window.__uiTest.performanceMetricsStats().active===1');
  const slowCount=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length`);
  await delay(1100);
  await check('Leitura lenta não cria consultas sobrepostas ou uma fila de atualizações',`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length===${slowCount}&&window.__uiTest.performanceMetricsStats().maxActive===1`);
  await emit('hidden',null);
  await evaluate(`window.__performanceGaugeBeforeHide=document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow');window.__uiTest.patch({performanceMetrics:{systemMetrics:{cpuPercent:91,memoryUsedBytes:5e9,memoryTotalBytes:20e9},memoryPressure:{level:'normal',freePercent:60},sampledAt:'2026-11-09T15:30:02.000Z'}});`);
  await waitFor('window.__uiTest.performanceMetricsStats().active===0');await delay(1100);
  await check('Ocultar o painel interrompe consultas e descarta a resposta tardia',`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length===${slowCount}&&document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')===window.__performanceGaugeBeforeHide`);
  await patch({performanceMetricsDelay:0});
  await emit('shown',null);
  await waitFor(`document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='91'`);
  await check('Reabrir o painel retoma os marcadores sem refazer processos',`document.getElementById('performanceMemoryGauge').getAttribute('aria-valuenow')==='25'&&window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===2`);
  await evaluate(`window.__performanceDocumentHidden=true;document.dispatchEvent(new Event('visibilitychange'));`);
  const documentHiddenCount=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length`);
  await delay(1200);
  await check('Documento invisível também interrompe a amostragem',`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length===${documentHiddenCount}`);
  await evaluate(`window.__performanceDocumentHidden=false;document.dispatchEvent(new Event('visibilitychange'));`);
  await waitFor(`window.__uiTest.calls().filter(c=>c.name==='getPerformanceMetrics').length>${documentHiddenCount}`);
  await reloadPerformance();await waitFor('!(document.querySelector("#performanceView .performance-panel").getAttribute("aria-busy")==="true")');
  await check('Reabrir a aba consulta serviços sem botão Atualizar nem som de conclusão',`window.__uiTest.calls().filter(c=>c.name==='getPerformance').length===3&&window.__uiTest.calls().filter(c=>c.name==='taskComplete').length===${soundCount}&&!document.getElementById('performanceRefresh')&&document.getElementById('performanceCpuGauge').getAttribute('aria-valuenow')==='27.5'`);
  await current.close();
}
async function privacyUi(){
  nativeTheme.themeSource='light';await windowFor('index.html',420,660);await waitFor('document.querySelectorAll(".cat").length===8');
  await check('Privacidade não lê dados ou abre navegadores ao iniciar',`!window.__uiTest.calls().some(c=>['getPrivacyBrowsers','openPrivacyBrowser'].includes(c.name))`);
  await view('privacy');await waitFor('document.querySelectorAll("#privacyBrowser option").length===2');
  await check('Privacidade oferece navegadores instalados e explica a confirmação nativa',`document.getElementById('privacyView').textContent.includes('próprio navegador')&&document.getElementById('privacyView').textContent.includes('cookies')&&!document.getElementById('privacyOpen').disabled`);
  await click('#privacyOpen');await waitFor('!document.getElementById("privacyOpen").disabled');
  await check('Abrir opções não afirma ter excluído dados nem toca som de tarefa concluída',`window.__uiTest.calls().filter(c=>c.name==='openPrivacyBrowser').at(-1).args[0]==='chrome'&&document.getElementById('privacyStatus').textContent.includes('confirme')&&!window.__uiTest.calls().some(c=>c.name==='taskComplete')`);
  await change('#privacyBrowser','safari');
  await check('Safari mostra seu caminho de histórico e dados dos sites',`document.getElementById('privacyGuide').textContent.includes('Histórico')&&document.getElementById('privacyGuide').textContent.includes('Gerenciar Dados')&&document.getElementById('privacyOpen').textContent==='Abrir navegador'`);
  await patch({privacyOpenError:true});await click('#privacyOpen');await waitFor('!document.getElementById("privacyOpen").disabled');
  await check('Erro ao abrir navegador é explícito e permite tentar novamente',`document.getElementById('privacyStatus').textContent.includes('Não foi possível abrir')&&!document.getElementById('privacyOpen').disabled`);
  await patch({privacyOpenError:false});await click('#privacyRefresh');await waitFor('!document.getElementById("privacyRefresh").disabled');
  await screenshot('privacidade-normal');
  for(const [width,height] of [[320,568],[420,520]]){current.setSize(width,height);await delay(30);await check(`Privacidade ${width}x${height} sem overflow`,`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.panel-nav button')].every(e=>e.scrollWidth<=e.clientWidth)`);}
  current.setSize(420,660);await change('#appearanceSelect','noturno');nativeTheme.themeSource='dark';await screenshot('privacidade-noturno');
  await patch({privacyError:true});await click('#privacyRefresh');await waitFor('!document.getElementById("privacyRefresh").disabled');
  await check('Falha de listagem desabilita abertura sem inventar navegadores',`document.getElementById('privacyStatus').textContent.includes('Não foi possível listar')&&document.getElementById('privacyOpen').disabled`);
  await patch({privacyError:false,privacyBrowsers:[]});await click('#privacyRefresh');await waitFor('!document.getElementById("privacyRefresh").disabled');
  await check('Privacidade vazia mostra orientação e impede abertura',`document.getElementById('privacyOpen').disabled&&document.getElementById('privacyStatus').textContent.includes('Nenhum navegador')`);
  await current.close();
}

async function themeAndFooterUi(){
  nativeTheme.themeSource='light';
  const main=await windowFor('index.html',420,660);await waitFor('document.querySelectorAll(".cat").length===8');
  const photos=await windowFor('photos.html',1120,800);await waitFor('!document.getElementById("scanBtn").disabled');
  for(const [mode,scheme] of [['normal','light'],['noturno','dark'],['automatico','light'],['automatico','dark']]){
    nativeTheme.themeSource=scheme;
    current=main;await emit('appearance',{appearance:mode,colorScheme:scheme});await delay(250);
    const colors=await evaluate(`(()=>{const app=getComputedStyle(document.querySelector('.app')),card=getComputedStyle(document.getElementById('disk')),button=getComputedStyle(document.getElementById('cleanBtn'));return{bg:app.backgroundColor,text:app.color,card:card.backgroundColor,border:card.borderColor,accent:button.backgroundColor};})()`);
    if(mode==='noturno')await screenshot('painel-noturno-unificado');
    current=photos;await emit('appearance',{appearance:mode,colorScheme:scheme});await delay(250);
    await check(`Painel e Duplicados compartilham cores em ${mode}/${scheme}`,`(()=>{const app=getComputedStyle(document.body),card=getComputedStyle(document.querySelector('.search-panel')),button=getComputedStyle(document.getElementById('scanBtn'));return JSON.stringify({bg:app.backgroundColor,text:app.color,card:card.backgroundColor,border:card.borderColor,accent:button.backgroundColor})===${JSON.stringify(JSON.stringify(colors))};})()`);
    if(mode==='noturno')await screenshot('duplicados-noturno-unificado');
  }
  current=main;
  for(const name of ['clean','apps','performance','privacy','devices','schedule','settings']){
    await view(name);
    await check(`Versão permanece no rodapé na aba ${name}`,`document.getElementById('appVersion').textContent==='v0.4.3'&&document.querySelector('.utility-row').contains(document.getElementById('appVersion'))&&document.getElementById('appVersion').getBoundingClientRect().height>0`);
  }
  await emit('updates',{current:'9.9.9',available:null});
  await check('Rodapé usa a versão do aplicativo e não metadados de atualização',`document.getElementById('appVersion').textContent==='v0.4.3'&&document.getElementById('settingsVersion').textContent==='Versão 0.4.3'`);
  for(const [width,height] of [[420,660],[320,568],[420,520]]){
    main.setSize(width,height);await delay(30);
    await check(`Rodapé ${width}x${height} exibe versão sem cortar controles`,`(()=>{const r=document.getElementById('appVersion').getBoundingClientRect(),f=document.querySelector('.utility-row').getBoundingClientRect();return r.height>0&&r.bottom<=innerHeight&&f.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;})()`);
  }
  main.destroy();photos.destroy();
}

async function soundUi(){
  nativeTheme.themeSource='light';
  await windowFor('index.html',420,660);
  await waitFor('document.querySelectorAll(".cat").length===8&&!document.getElementById("refreshBtn").disabled');
  await check('Abrir o painel não emite som',`!window.__uiTest.calls().some(c=>c.name==='taskComplete')`);
  await refresh();
  await check('Análise manual avisa uma vez ao concluir',`window.__uiTest.calls().filter(c=>c.name==='soundPlayed').length===1`);
  await emit('shown',null);await delay(70);
  await check('Reabrir o painel e reanalisar automaticamente não emite outro som',`window.__uiTest.calls().filter(c=>c.name==='soundPlayed').length===1`);
  await view('settings');await click('#soundPreview');await delay(20);
  await check('Ajustes oferece prévia do som de conclusão',`document.getElementById('soundEnabled').checked&&window.__uiTest.calls().filter(c=>c.name==='soundPlayed').length===2`);
  await click('#soundEnabled');await delay(20);
  await check('Desligar o som salva a preferência e desativa a prévia',`window.__uiTest.get().soundEnabled===false&&!document.getElementById('soundEnabled').checked&&document.getElementById('soundPreview').disabled`);
  await view('clean');await refresh();
  await check('Tarefa manual continua concluindo com som desligado',`!document.getElementById('refreshBtn').disabled&&window.__uiTest.calls().filter(c=>c.name==='soundPlayed').length===2`);
  await view('settings');await click('#soundEnabled');await delay(20);
  await patch({soundSaveError:true});await click('#soundEnabled');await delay(20);
  await check('Falha ao salvar som restaura a escolha anterior',`document.getElementById('soundEnabled').checked&&window.__uiTest.get().soundEnabled&&!document.getElementById('soundEnabled').disabled&&document.getElementById('appStatusText').textContent.includes('Falha ao salvar')`);
  await patch({soundSaveError:false,soundPlaybackError:true});await view('clean');await refresh();
  await check('Falha de áudio não transforma a tarefa em erro nem deixa botões bloqueados',`!document.getElementById('refreshBtn').disabled&&window.__uiTest.calls().filter(c=>c.name==='soundPlayed').length===2`);
  await patch({soundPlaybackError:false});
  const before=await evaluate(`window.__uiTest.calls().filter(c=>c.name==='taskComplete').length`);
  await click('#cleanBtn');await click('#confirmCancel');
  await check('Cancelar a confirmação de limpeza não emite som',`window.__uiTest.calls().filter(c=>c.name==='taskComplete').length===${before}`);
  await patch({cleanAllFailed:true});await click('#cleanBtn');await click('#confirmOk');await waitFor('!document.getElementById("cleanBtn").classList.contains("busy")');
  await check('Limpeza com todos os itens recusados não emite som de conclusão',`window.__uiTest.calls().filter(c=>c.name==='taskComplete').length===${before}`);
  await view('settings');await evaluate(`document.getElementById('soundEnabled').scrollIntoView({block:'center'})`);await screenshot('ajustes-som');
  await current.close();
}

async function photoUi(){
  nativeTheme.themeSource='light';
  await windowFor('photos.html',1120,800);await waitFor('!document.getElementById("scanBtn").disabled');
  await check('Duplicados abre com modos separados e sem seleção de remoção',`document.getElementById('modePhotos').getAttribute('aria-selected')==='true'&&document.querySelectorAll('#roots input:checked').length===2&&document.getElementById('trashBtn').disabled`);
  await evaluate(`document.querySelectorAll('#roots input').forEach(e=>e.click())`);
  await check('Sem pastas selecionadas a busca fica bloqueada',`document.getElementById('scanBtn').disabled`);
  await evaluate(`document.querySelectorAll('#roots input').forEach(e=>e.click())`);
  await click('#addFolderBtn');await delay(20);
  await check('Adicionar pasta invalida resultado e seleciona a nova raiz',`document.querySelectorAll('#roots input').length===3&&document.querySelectorAll('#roots input:checked').length===3&&document.getElementById('trashBtn').disabled`);
  await photoPatch({scanDelay:150});await click('#scanBtn');await delay(10);
  await check('Busca mostra progresso e bloqueia troca de modo',`!document.getElementById('progressPanel').hidden&&document.getElementById('modeFiles').disabled`);
  await click('#cancelBtn');await delay(170);
  await check('Busca cancelada não habilita envio',`document.getElementById('trashBtn').disabled&&document.getElementById('emptyTitle').textContent.includes('cancelada')`);
  await photoPatch({scanDelay:30});await click('#scanBtn');await waitFor('document.querySelectorAll(".photo-card").length===3');
  await check('Busca concluída agrupa cópias e mostra metadados',`document.querySelectorAll('.group-item').length===2&&document.querySelectorAll('.photo-card').length===3&&document.querySelector('.file-meta').textContent.includes('6,4 MB')&&document.querySelector('.file-path').textContent.includes('Imagens')`);
  await check('Duplicados avisa ao concluir a busca e fica silencioso no cancelamento',`window.__uiTest.calls().filter(c=>c.name==='photo.taskComplete').length===1`);
  await click('.keep-copy');
  await check('Manter só esta seleciona demais e preserva uma cópia',`document.querySelectorAll('#photoGrid input:checked').length===2&&document.querySelectorAll('.keep-copy[aria-pressed="true"]').length===1`);
  await click('#photoGrid input:not(:checked)');
  await check('Selecionar todas as cópias é impedido',`document.querySelectorAll('#photoGrid input:checked').length===2&&document.getElementById('errorText').textContent.includes('Pelo menos uma')`);
  await click('.finder-button');await click('#openPhotosBtn');await delay(20);
  await check('Finder e Fotos são ações explícitas e passam IDs/mode',`window.__uiTest.calls().some(c=>c.name==='photo.reveal'&&c.args[1]==='photos')&&window.__uiTest.calls().some(c=>c.name==='photo.openPhotos')`);
  await click('#trashBtn');
  await check('Envio exige confirmação com quantidade e mantém Lixeira fechada',`document.getElementById('confirmDialog').open&&document.getElementById('confirmText').textContent.includes('2 arquivos')&&document.querySelector('.confirmation-note').textContent.includes('não será esvaziada')`);
  await click('#confirmCancel');
  await check('Cancelar envio não chama API de Lixeira',`!window.__uiTest.calls().some(c=>c.name==='photo.trash')`);
  await click('#trashBtn');await click('#confirmMove');await delay(40);
  await check('Envio simulado informa que arquivos continuam e limpa seleção',`document.getElementById('resultText').textContent.includes('continuam')&&document.querySelectorAll('#photoGrid input:checked').length===0&&window.__uiTest.calls().filter(c=>c.name==='photo.trash').at(-1).args[0].expectedDryRun===true`);
  await check('Envio confirmado de duplicados emite um único aviso de conclusão',`window.__uiTest.calls().filter(c=>c.name==='photo.taskComplete').length===2`);
  await click('.keep-copy');await click('#clearSelectionBtn');
  await check('Limpar seleção mantém grupo e bloqueia ação de envio',`document.querySelectorAll('.photo-card').length===3&&document.querySelectorAll('#photoGrid input:checked').length===0&&document.getElementById('trashBtn').disabled`);
  await screenshot('duplicados-fotos-normal');
  await click('#modeFiles');await waitFor('document.getElementById("modeFiles").getAttribute("aria-selected")==="true"&&!document.getElementById("scanBtn").disabled');
  await check('Modo Arquivos seleciona Downloads e mantém raízes próprias',`document.querySelectorAll('#roots input').length===2&&document.querySelectorAll('#roots input:checked').length===1&&document.getElementById('fileTypesNote').textContent.includes('compactados')`);
  await click('#scanBtn');await waitFor('document.querySelectorAll(".group-item").length===4');
  await check('Arquivos mostram documentos vídeos áudios e compactados sem miniaturas',`document.querySelectorAll('.group-item').length===4&&document.querySelectorAll('.file-art').length>0&&document.querySelector('#photoGrid img')===null&&document.querySelector('#photoGrid').textContent.includes('MP4')`);
  await click('.keep-copy');await photoPatch({partial:true});await click('#trashBtn');await click('#confirmMove');await delay(40);
  await check('Arquivos alterados são preservados e motivo aparece',`!document.getElementById('resultDetails').hidden&&document.getElementById('resultDetails').textContent.includes('Arquivo alterado')`);
  await screenshot('duplicados-arquivos-normal');
  await click('#modePhotos');await waitFor('!document.getElementById("scanBtn").disabled');
  await check('Retornar ao modo Fotos restaura escopo sem manter seleção',`document.querySelectorAll('#roots input').length===3&&document.querySelectorAll('#photoGrid input:checked').length===0`);
  await photoPatch({scanError:true});await click('#scanBtn');await delay(60);
  await check('Falha de busca exibe erro e não autoriza mover',`document.getElementById('errorText').textContent.includes('Falha de busca')&&document.getElementById('trashBtn').disabled&&!document.getElementById('scanBtn').disabled`);
  await photoPatch({scanError:false,empty:true});await click('#scanBtn');await delay(60);
  await check('Busca sem duplicados mostra estado vazio apropriado',`document.getElementById('emptyTitle').textContent.includes('Nenhuma foto')&&document.getElementById('trashBtn').disabled`);
  await emit('appearance',{appearance:'noturno',colorScheme:'dark'});await delay(30);
  await check('Janela de duplicados acompanha tema compartilhado',`getComputedStyle(document.documentElement).colorScheme.includes('dark')`);
  await screenshot('duplicados-noturno');
  current.setSize(820,600);await delay(50);
  await check('Janela de duplicados redimensionada mantém controles principais visíveis',`document.documentElement.scrollWidth<=innerWidth&&document.getElementById('trashBtn').getBoundingClientRect().bottom<=innerHeight`);
}
app.whenReady().then(async()=>{
  await fs.mkdir(output,{recursive:true});
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/i.test(details.url)}));
  nativeTheme.themeSource='light';
  await mainUi();await applicationsUi();await performanceUi();await performanceAutomaticUi();await privacyUi();await soundUi();await photoUi();await themeAndFooterUi();
}).catch(error=>{results.push({name:'Execução do roteiro',status:'fail',error:error.stack});console.error(error);}).finally(async()=>{
  for(const win of windows)if(!win.isDestroyed())win.destroy();
  const summary={at:new Date().toISOString(),passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,checks:results,consoleErrors:errors,environment:{main:'HTML/CSS/renderer reais com APIs fixture',photos:'HTML/CSS/renderer reais com APIs fixture',applications:'HTML/CSS/módulo reais com APIs fixture',performance:'HTML/CSS/módulo reais com APIs fixture',personalFiles:false,realCleaning:false,realUninstall:false,realProcessSignals:false,realNetwork:false,realLaunchAgent:false}};
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'resultado-ui.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(`RESULT ${summary.passed} passed, ${summary.failed} failed; ${output}`);
  app.exit(summary.failed?1:0);
});
