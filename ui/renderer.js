const $ = (id) => document.getElementById(id);

// Ícones Phosphor (MIT) vindos de icons.js. Fallback: documento.
const svg = (name) =>
  `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${window.ICONS[name] || window.ICONS.logs}</svg>`;

function hydrateIcons() {
  for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', svg(el.dataset.icon));
}

const LEVEL = { seguro: 'Seguro', atencao: 'Atenção', revisar: 'Revisar', manual: 'Manual' };
const isCleanable = (c) => c.level === 'seguro' || c.level === 'atencao';

let runSeq = 0; // identifica a análise mais recente; resultados de análises antigas são descartados
let applicationsTool = null;
let performanceTool = null;
let privacyTool = null;

// ---- Tooltip próprio ----
// O `title` nativo é desenhado pelo sistema e pode estourar a borda da janela; este fica
// sempre dentro dela (largura máxima, quebra de linha e inversão para cima se faltar espaço).
const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.setAttribute('role', 'tooltip');
tipEl.hidden = true;
document.body.append(tipEl);
let tipTimer = null;
let tipTarget = null;

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  tipEl.hidden = true;
}

function showTip(target) {
  tipEl.textContent = target.dataset.tip;
  tipEl.hidden = false;
  const M = 8;
  const r = target.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(M, Math.min(x, window.innerWidth - w - M));
  // Padrão: embaixo do elemento. Com data-tip-pos="top" fica em cima, para não cobrir o que vem logo abaixo (ex.: linha de status).
  const above = target.dataset.tipPos === 'top';
  if (target.dataset.tipPos === 'right') {
    tipEl.style.left = `${Math.round(Math.min(r.right + 6, window.innerWidth - w - M))}px`;
    tipEl.style.top = `${Math.round(Math.max(M, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - M)))}px`;
    return;
  }
  let y = above ? r.top - h - 6 : r.bottom + 6;
  if (!above && y + h > window.innerHeight - M) y = r.top - h - 6; // sem espaço embaixo: vai para cima
  else if (above && y < M) y = r.bottom + 6;
  y = Math.max(M, y);
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
}

document.addEventListener('mouseover', (e) => {
  const t = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
  if (!t || !t.dataset.tip) { if (tipTarget) hideTip(); return; }
  if (t === tipTarget) return;
  hideTip();
  tipTarget = t;
  tipTimer = setTimeout(() => showTip(t), 600);
});
document.addEventListener('mouseleave', hideTip);
document.addEventListener('mousedown', hideTip);
document.addEventListener('scroll', hideTip, true);

const state = {
  dryRun: true,
  version: '',
  cats: [],
  info: {},        // id -> análise
  selected: new Set(),
  busy: false,
  total: 0,
  volumes: [],
  confirmedClean: null,
  view: 'clean',
};

// Reorganiza os mesmos controles em painéis; nenhum fluxo de limpeza é substituído.
function setupCompactLayout() {
  const app = document.querySelector('.app');
  const header = document.querySelector('.top');
  const scroll = $('scroll');
  const heading = $('cats').previousElementSibling;
  const bottom = document.querySelector('.bottom');
  bottom.id = 'bottom';
  const utility = document.createElement('div');
  utility.className = 'utility-row';
  const quit = $('quitBtn');
  quit.className = 'icon-btn power-button';
  quit.replaceChildren(); // fillIcons insere o ícone power existente uma única vez.
  utility.append($('simPill'), $('creditBtn'));
  $('appVersion').className='app-version';
  utility.append($('appVersion'));
  header.append(quit);
  app.insertBefore(utility, $('confirm'));
  document.querySelector('.top-actions').remove();
  const appearanceLabel = document.createElement('label');
  appearanceLabel.className = 'appearance-control';
  appearanceLabel.innerHTML = '<span>Exibição</span><select id="appearanceSelect" aria-label="Modo de exibição"><option value="normal">Normal</option><option value="noturno">Noturno</option><option value="automatico">Automático</option></select>';
  const nav = document.createElement('nav');
  nav.className = 'panel-nav'; nav.setAttribute('aria-label','Ferramentas do CalangoClean');
  // Barra lateral só com ícones; o nome de cada ferramenta fica no tooltip e no aria-label.
  const NAV = [['clean','navClean','Limpeza'],['photos','navDuplicates','Duplicados (abre outra janela)'],['performance','gauge','Desempenho'],['apps','navApps','Apps'],['privacy','navPrivacy','Privacidade'],['devices','hardDrives','Dispositivos'],['schedule','calendar','Agenda'],['settings','navSettings','Ajustes']];
  $('photosBtn')?.remove(); // o botão antigo do conteúdo vira o ícone Duplicados da barra
  for (const [view,icon,label] of NAV) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.tip = label; button.dataset.tipPos = 'right';
    button.setAttribute('aria-label', label); button.innerHTML = svg(icon);
    if (view === 'photos') { button.id = 'photosBtn'; button.setAttribute('aria-label','Abrir busca de fotos e arquivos duplicados'); }
    else { button.dataset.view = view; if (view === 'clean') button.setAttribute('aria-current','page'); }
    nav.append(button);
  }
  header.after(nav);
  const panels = {};
  for (const [key,label] of Object.entries({clean:'Limpeza',performance:'Desempenho',apps:'Desinstalar aplicativos',privacy:'Privacidade',devices:'Dispositivos',schedule:'Agendamento',settings:'Ajustes'})) {
    const panel = document.createElement('section');
    panel.className = 'view-panel'; panel.id = `${key}View`; panel.dataset.viewPanel = key;
    panel.setAttribute('aria-label',label); panel.hidden = key !== 'clean'; panels[key] = panel;
  }
  const machine = $('machine');
  const health = $('health'); health.className = 'health-inline'; health.replaceChildren($('healthText'));
  const diskUsage = document.querySelector('#disk .usage');
  const healthGroup = document.createElement('span'); healthGroup.append(health, document.createTextNode(' · '), $('pctValue')); diskUsage.append(healthGroup);
  const details = document.createElement('button'); details.type = 'button'; details.className = 'link';
  details.id = 'detailsToggle'; details.textContent = 'Detalhes'; details.setAttribute('aria-expanded','false');
  const actions = document.createElement('div'); actions.className = 'section-actions'; actions.append(details, $('toggleAll')); heading.append(actions);
  heading.querySelector('h2').textContent = 'Limpeza';
  panels.clean.append($('disk'),$('chips'),heading,$('cats'),$('featured'),$('infoToggle'),$('infos'),$('result'));
  const devicesHeading = document.createElement('div'); devicesHeading.className = 'view-heading';
  devicesHeading.innerHTML = '<h2>Discos, rede e Bluetooth</h2>'; devicesHeading.append(machine);
  const mainDiskCard = document.createElement('section'); mainDiskCard.className = 'device-volume-card card';
  mainDiskCard.innerHTML = '<button type="button" class="device-fold-toggle" id="showFolders" aria-expanded="false" aria-controls="diskDetail"><span id="mainDiskName">Disco principal</span><span class="device-fold-caption">Ocupação por pastas</span><span class="device-fold-caret" aria-hidden="true">⌄</span></button>';
  $('diskDetail').classList.remove('card');
  mainDiskCard.append($('diskDetail'));
  const networkCard = document.createElement('section'); networkCard.className = 'device-volume-card card';
  networkCard.innerHTML = '<button type="button" class="device-fold-toggle" id="showNetwork" aria-expanded="false" aria-controls="chipDetail"><span>Rede</span><span class="device-fold-caption" id="networkFoldLabel"></span><span class="device-fold-caret" aria-hidden="true">⌄</span></button>';
  $('chipDetail').classList.remove('card'); networkCard.append($('chipDetail'));
  const folderError = document.createElement('div'); folderError.id = 'folderError'; folderError.className = 'detail-error'; folderError.hidden = true; folderError.setAttribute('role','status'); mainDiskCard.querySelector('#diskDetail').append(folderError);
  const volumeList = document.createElement('div'); volumeList.id = 'deviceVolumes'; volumeList.className = 'device-volumes';
  const btList = document.createElement('ul'); btList.id = 'btDetails'; btList.className = 'bt-details card'; btList.setAttribute('aria-label','Aparelhos Bluetooth conectados');
  const bluetoothCard = document.createElement('section'); bluetoothCard.className = 'device-volume-card card';
  bluetoothCard.innerHTML = '<button type="button" class="device-fold-toggle" id="showBluetooth" aria-expanded="false" aria-controls="btDetails"><span>Bluetooth</span><span class="device-fold-caption" id="bluetoothFoldLabel"></span><span class="device-fold-caret" aria-hidden="true">⌄</span></button>';
  btList.hidden = true; btList.classList.remove('card'); bluetoothCard.append(btList);
  panels.devices.append(devicesHeading,mainDiskCard,Object.assign(document.createElement('h3'),{textContent:'Discos externos'}),volumeList,networkCard,bluetoothCard);
  panels.schedule.innerHTML = '<div class="view-heading"><h2>Limpeza automática</h2><p>Somente categorias seguras selecionadas.</p></div>';
  const last = document.createElement('div'); last.id = 'schedLast'; last.className = 'view-note'; $('sched').append(last);
  panels.schedule.append($('sched'));
  const scheduleNote = document.createElement('p'); scheduleNote.className = 'view-note'; scheduleNote.textContent = 'A Lixeira, a revisão manual e os duplicados ficam fora do agendamento. Intervalo mínimo de cinco dias entre limpezas.'; panels.schedule.append(scheduleNote);
  panels.settings.innerHTML = '<div class="view-heading"><h2>Ajustes e atualizações</h2></div><section class="settings-card card"><h3>Aparência</h3><p id="appearanceDescription">Automático acompanha a aparência do macOS.</p></section><section class="settings-card card"><h3>Permissões</h3><p>Acesso Total ao Disco permite medir pastas protegidas. Automação permite controlar o Finder ao esvaziar toda a Lixeira.</p><div class="settings-actions"><button type="button" class="mini" id="diskPrivacyBtn">Acesso Total ao Disco</button><button type="button" class="mini" id="automationPrivacyBtn">Automação</button></div></section><section class="settings-card card"><h3>Seja Calango</h3><p>O CalangoClean funciona sem conta. Você pode entrar na plataforma pelo navegador.</p><button type="button" class="mini" id="accountBtn">Entrar na Seja Calango ↗</button><p class="view-note">Opcional. Sua senha fica no serviço de login do site.</p></section>';
  panels.settings.querySelector('.settings-card').append(appearanceLabel);
  const settingsVersion=document.createElement('span');settingsVersion.id='settingsVersion';document.querySelector('.update-row').prepend(settingsVersion);
  const updateCard = document.createElement('section'); updateCard.className = 'settings-card card';
  const updateHeading = document.createElement('h3'); updateHeading.textContent = 'Atualizações';
  updateCard.append(updateHeading, document.querySelector('.update-row'),$('updateBanner'),$('updateStatus')); panels.settings.append(updateCard);
  const soundCard=document.createElement('section');soundCard.className='settings-card card';
  soundCard.innerHTML='<h3>Avisos sonoros</h3><p>Um toque curto ao concluir tarefas manuais.</p><div class="settings-actions"><label class="sound-control"><input type="checkbox" id="soundEnabled" /> Som de conclusão</label><button type="button" class="mini" id="soundPreview" disabled>Ouvir som</button></div>';
  panels.settings.append(soundCard);
  scroll.replaceChildren(...Object.values(panels));
  applicationsTool=window.CalangoApplications.initialize({container:panels.apps,api:window.limpa,notify:showStatus,onComplete:taskComplete,onMutation:()=>{window.limpa.analyze('trashOld').then(applyAnalysis).catch(()=>{});window.limpa.diskInfo().then(renderDisk).catch(()=>{});},formatBytes:fmt});
  performanceTool=window.CalangoPerformance.initialize({container:panels.performance,api:window.limpa,notify:showStatus,onComplete:taskComplete,formatBytes:fmt});
  privacyTool=window.CalangoPrivacy.initialize({container:panels.privacy,api:window.limpa});
  document.querySelector('.credit-row')?.remove();
  const status = document.createElement('div'); status.id = 'appStatus'; status.className = 'app-status'; status.hidden = true; status.setAttribute('role','status');
  status.innerHTML = '<span id="appStatusText"></span><button type="button" id="appStatusClose" aria-label="Fechar aviso">×</button>'; nav.after(status);
  $('appStatusClose').addEventListener('click',()=>{status.hidden=true;});
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>activateView(button.dataset.view)));
  details.addEventListener('click',()=>{const open=panels.clean.classList.toggle('show-details');details.setAttribute('aria-expanded',String(open));details.textContent=open?'Menos detalhes':'Detalhes';});
  $('showFolders').addEventListener('click',toggleDisk);
  $('showNetwork').addEventListener('click',()=>{ networkExpanded = !networkExpanded; renderDetail(); });
  $('showBluetooth').addEventListener('click',()=>{ bluetoothExpanded = !bluetoothExpanded; renderDeviceList(); });
  $('diskPrivacyBtn').addEventListener('click',()=>window.limpa.openPrivacy('fullDisk'));
  $('automationPrivacyBtn').addEventListener('click',()=>window.limpa.openPrivacy('automation'));
  $('accountBtn').addEventListener('click',async()=>{try{const result=await window.limpa.openAccount();if(result?.ok===false)showStatus(result.error);}catch{showStatus('Não foi possível abrir a Seja Calango.');}});
}

function activateView(view) {
  if (!['clean','performance','apps','privacy','devices','schedule','settings'].includes(view)) return;
  if(state.view==='apps'&&view!=='apps')applicationsTool?.deactivate?.();
  if(state.view==='performance'&&view!=='performance')performanceTool?.deactivate?.();
  if(state.view==='privacy'&&view!=='privacy')privacyTool?.deactivate?.();
  const previousView = state.view;
  state.view=view; hideTip();
  document.querySelectorAll('[data-view-panel]').forEach(panel=>{panel.hidden=panel.dataset.viewPanel!==view;});
  document.querySelectorAll('[data-view]').forEach(button=>{if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('bottom').hidden=view!=='clean'; $('scroll').scrollTop=0;
  if(view==='devices'){renderDeviceList();if(previousView!=='devices')void prepareDevicePanels();}
  if(view==='apps'){applicationsTool?.refresh();}
  if(view==='performance'){performanceTool?.refresh();}
  if(view==='privacy'){privacyTool?.refresh();}
}

function showStatus(message) { $('appStatusText').textContent=message; $('appStatus').hidden=!message; }

function taskComplete() {
  try { window.limpa.taskComplete?.().catch(()=>{}); } catch { /* Som nunca altera o resultado da tarefa. */ }
}

function applyAppearance(view) {
  if(!view||!['light','dark'].includes(view.colorScheme))return;
  document.documentElement.style.colorScheme=view.colorScheme;
  document.documentElement.dataset.colorScheme=view.colorScheme;
  state.appearance = { appearance: view.appearance, colorScheme: view.colorScheme };
  $('appearanceSelect').value=['normal','noturno','automatico'].includes(view.appearance)?view.appearance:'automatico';
  $('appearanceDescription').textContent={normal:'Normal mantém a aparência clara.',noturno:'Noturno mantém a aparência escura.',automatico:'Automático acompanha a aparência do macOS.'}[$('appearanceSelect').value];
}

const num1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pct0 = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const plural = new Intl.PluralRules('pt-BR');

// Tamanhos em base 10 (1 KB = 1000 bytes), igual ao Finder desde o macOS 10.6.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
function fmt(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  let i = Math.min(Math.floor(Math.log10(bytes) / 3), UNITS.length - 1);
  if (Number((bytes / 1000 ** i).toFixed(1)) >= 1000 && i < UNITS.length - 1) i++; // 999,96 KB -> 1,0 MB
  const v = bytes / 1000 ** i;
  return `${i === 0 ? int0.format(v) : num1.format(v)} ${UNITS[i]}`;
}

function categorias(n) {
  return `${int0.format(n)} ${plural.select(n) === 'one' ? 'categoria' : 'categorias'}`;
}

const cardEl = (id) => document.querySelector(`.cat[data-id="${id}"]`);

// Saúde por ocupação: até 80% Boa, até 90% Atenção, acima Crítica.
function healthOf(pct) {
  if (pct <= 0.8) return { state: 'ok', text: 'Boa' };
  if (pct <= 0.9) return { state: 'warn', text: 'Atenção' };
  return { state: 'crit', text: 'Crítica' };
}

function renderDisk(d) {
  const pct = d.used / d.total;
  const h = healthOf(pct);
  $('health').dataset.state = h.state;
  $('disk').dataset.state = h.state;
  $('healthText').textContent = h.text;
  if (d.volume) { $('volName').textContent = d.volume; if ($('mainDiskName')) $('mainDiskName').textContent = d.volume; }
  $('freeValue').textContent = fmt(d.free);
  $('usedValue').textContent = fmt(d.used);
  $('totalValue').textContent = fmt(d.total);
  $('pctValue').textContent = pct0.format(pct);
  $('barFill').style.width = `${Math.min(100, pct * 100).toFixed(1)}%`;
  $('bar').setAttribute('aria-valuenow', String(Math.round(pct * 100)));
}

function buildCard(c, featured = false) {
  const interactive = isCleanable(c);
  const hasOpt = interactive && c.option === 'trashDays';
  const li = document.createElement('li');
  li.className = interactive ? 'cat on' : featured ? 'cat info featured' : 'cat info';
  li.dataset.id = c.id;
  li.dataset.level = c.level;
  li.dataset.tip = c.detail || c.hint; // texto completo no tooltip
  // Destaque: no lugar do interruptor entra o botão da ação; a descrição ocupa uma linha inteira embaixo.
  li.innerHTML = featured ? `
    <div class="cat-icon">${svg(c.id)}</div>
    <div class="cat-body"><div class="cat-name"><span class="n"></span><span class="badge"></span></div></div>
    <div class="cat-size"><span class="skeleton"></span></div>
    <button class="mini solid cat-action" hidden></button>
    <div class="cat-desc cat-desc-row"></div>
    <div class="cat-details" hidden></div>` : `
    <div class="cat-icon">${svg(c.id)}</div>
    <div class="cat-body">
      <div class="cat-name"><span class="n"></span><span class="badge"></span></div>
      <div class="cat-desc"></div>
    </div>
    ${hasOpt ? '<label class="cat-opts"><span>Prazo</span><select class="days" aria-label="Prazo da Lixeira"></select></label>' : ''}
    <div class="cat-size"><span class="skeleton"></span></div>
    ${interactive ? '<label class="switch"><input type="checkbox" checked /><i></i></label>' : ''}
    <div class="cat-details" hidden></div>`;
  li.querySelector('.n').textContent = c.label;
  li.querySelector('.n').dataset.tip = c.label; // nome completo se o título for cortado com ellipsis
  const b = li.querySelector('.badge');
  b.textContent = LEVEL[c.level] || c.level;
  b.classList.add(c.level);
  li.querySelector('.cat-desc').textContent = featured && c.featuredHint ? c.featuredHint : c.hint;
  const act = li.querySelector('.cat-action');
  if (act) {
    act.textContent = c.actionLabel || 'Abrir';
    act.addEventListener('click', () => window.limpa.openCategory(c.id)); // só abre o app; nunca apaga
  }

  if (interactive) {
    const cb = li.querySelector('input');
    cb.setAttribute('aria-label', `Selecionar ${c.label}`);
    li.prepend(li.querySelector('.switch'));
    cb.addEventListener('change', async () => {
      const previous = state.selected.has(c.id);
      cb.checked ? state.selected.add(c.id) : state.selected.delete(c.id);
      c.enabled = cb.checked;
      c.saving = true; cb.disabled = true;
      refreshSelection();
      try {
        const saved = await window.limpa.setCategory(c.id, cb.checked);
        if(saved === false) throw new Error('Não foi possível salvar a seleção.');
      } catch {
        previous ? state.selected.add(c.id) : state.selected.delete(c.id);
        c.enabled = previous; cb.checked = previous;
        showStatus('Não foi possível salvar a seleção. A escolha anterior foi mantida.');
      } finally { c.saving=false; cb.disabled=false; refreshSelection(); }
    });
    const sel = li.querySelector('select.days');
    if (sel) {
      sel.addEventListener('change', async () => {
        const days = Number(sel.value);
        sel.disabled = true;
        const r = await window.limpa.setTrashDays(days).catch(() => ({ ok: false }));
        sel.disabled = false;
        window.limpa.analyze(c.id).then(applyAnalysis).catch(()=>showStatus('Não foi possível medir a Lixeira. Analise novamente.'));
        if (!r.ok) showStatus(r.error || 'Não foi possível salvar o prazo.');
      });
    }
    li.addEventListener('click', (e) => {
      if (e.target.closest('.switch') || e.target.closest('.cat-opts') || cb.disabled) return; // seletor não liga/desliga o card
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  }
  return li;
}

function buildList() {
  $('cats').replaceChildren(...state.cats.filter(isCleanable).map((c) => buildCard(c))); // sem passar o índice do map
  const infos = state.cats.filter((c) => !isCleanable(c));
  $('infos').replaceChildren(...infos.map((c) => buildCard(c)));
  $('infoToggle').hidden = infos.length === 0;
  $('infoCount').textContent = String(infos.length);
}

// Categoria com `highlightAbove` (WhatsApp): acima do limite o card sobe para a lista principal,
// logo abaixo das categorias com interruptor; abaixo dele volta para "Para revisar".
const wantFeatured = (c, a) => Boolean(c.highlightAbove) && a.found && !a.accessIssue && a.bytes > c.highlightAbove;

function syncSections() {
  $('featured').hidden = $('featured').children.length === 0;
  const n = $('infos').children.length;
  $('infoToggle').hidden = n === 0;
  $('infoCount').textContent = String(n);
}

function placeCard(c, a) {
  const li = cardEl(c.id);
  const want = wantFeatured(c, a);
  if (!c.highlightAbove || li.classList.contains('featured') === want) return li;
  const next = buildCard(c, want);
  li.remove();
  const ul = want ? $('featured') : $('infos');
  ul.append(next);
  const order = (el) => state.cats.findIndex((x) => x.id === el.dataset.id);
  [...ul.children].sort((x, y) => order(x) - order(y)).forEach((n) => ul.append(n)); // ordem original
  syncSections();
  return next;
}

function toggleInfos() {
  const open = $('infoToggle').getAttribute('aria-expanded') !== 'true';
  $('infoToggle').setAttribute('aria-expanded', String(open));
  $('infos').hidden = !open;
  if (open) $('infos').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetails(li, rows) {
  const box = li.querySelector('.cat-details');
  box.replaceChildren();
  box.hidden = rows.length === 0;
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'drow';
    const l = document.createElement('span');
    l.className = 'dl';
    l.textContent = r.label; // nomes de arquivos/sites são dados externos: sempre textContent
    l.dataset.tip = r.label;
    const sz = document.createElement('b');
    sz.className = 'dsz';
    sz.textContent = fmt(r.bytes);
    row.append(l, sz);
    if (r.path) {
      const btn = document.createElement('button');
      btn.className = 'mini';
      btn.textContent = 'Mostrar no Finder';
      btn.addEventListener('click', () => window.limpa.reveal(r.path));
      row.append(btn);
    }
    box.append(row);
  }
}

function hasTechnicalReason(message) {
  return typeof message === 'string' && /\bE[A-Z]{2,}\b|\b(?:com|org|net)\.[A-Za-z0-9_.-]+|\/(?:Users|Library|Applications)\//.test(message);
}

function simpleCleanReason(message, measurement = false) {
  return hasTechnicalReason(message) ? measurement ? 'Alguns arquivos não puderam ser analisados' : 'Alguns arquivos foram mantidos' : message;
}

function applyAnalysis(a) {
  state.info[a.id] = a;
  const c = state.cats.find((x) => x.id === a.id);
  const li = placeCard(c, a);
  const blocked = !!a.blockedReason;

  const size = li.querySelector('.cat-size');
  size.textContent = a.found && !a.accessIssue && !a.settings?.measurementError ? fmt(a.bytes) : '—';
  delete size.dataset.tip;

  // Selo curto na linha da descrição (some o texto normal enquanto houver aviso);
  // o texto completo continua no tooltip do card.
  const desc = li.querySelector('.cat-desc');
  const keptFiles = (a.settings?.remainingCount > 0 || hasTechnicalReason(a.settings?.statusReason)) && !a.settings?.measurementError && !a.settings?.measurementPartial;
  const status = a.accessIssue ? 'Sem permissão'
    : a.settings?.statusReason ? simpleCleanReason(a.settings.statusReason, a.settings.measurementError || a.settings.measurementPartial)
    : blocked ? c.requiresBrowserQuit ? 'Navegadores serão fechados após confirmar' : a.blockedReason
    : !a.found ? 'Não encontrado' : '';
  desc.classList.toggle('warn', !!status && !keptFiles);
  if (status) desc.classList.remove('note');
  desc.replaceChildren();
  if (status) {
    if(!keptFiles)desc.insertAdjacentHTML('afterbegin', svg('warning'));
    const t = document.createElement('span');
    t.textContent = status;
    desc.append(t);
    li.dataset.tip = `${a.accessIssue || a.settings?.statusDetails || a.settings?.statusReason || a.blockedReason || status}. ${c.detail || c.hint}`;
    desc.dataset.tip = a.settings?.statusDetails || a.settings?.statusReason || a.accessIssue || a.blockedReason || status;
  } else {
    delete desc.dataset.tip;
    desc.textContent = a.note || (li.classList.contains('featured') && c.featuredHint ? c.featuredHint : c.hint);
    desc.classList.toggle('note', Boolean(a.note));
    li.dataset.tip = [a.note && `${a.note}.`, a.tip, c.detail || c.hint].filter(Boolean).join(' ');
  }

  const act = li.querySelector('.cat-action'); // "Abrir WhatsApp": some se o app não estiver instalado
  if (act) act.hidden = a.canOpen !== true;

  if (!isCleanable(c)) {
    renderDetails(li, a.details || []);
    renderBanner();
    return;
  }
  // O interruptor pode ser ligado mesmo com 0 B: a escolha fica salva no config para as próximas
  // análises. A Lixeira também pode conter itens vazios para apagar.
  const cb = li.querySelector('input');
  cb.disabled = !!c.saving;
  cb.checked = state.selected.has(a.id);
  fillDays(li, a.settings && a.settings.days);
  refreshSelection();
  renderBanner();
}

// Categorias selecionadas que têm algo para apagar agora, inclusive itens vazios da Lixeira.
const actionableIds = () => [...state.selected].filter((id) => {
  const a = state.info[id];
  const c = state.cats.find((cat) => cat.id === id);
  return a && a.found && (!a.blockedReason || c?.requiresBrowserQuit) && !a.accessIssue && !a.settings?.measurementError &&
    (a.bytes > 0 || (id === 'trashOld' && a.settings?.eligibleCount > 0));
});

// Seletor de prazo da Lixeira: 0 (tudo), 7, 15 ou 30 dias; um valor diferente vindo do config também aparece.
const DAYS_OPTIONS = [0, 7, 15, 30];
function fillDays(li, days) {
  const sel = li.querySelector('select.days');
  if (!sel || days === undefined) return;
  const values = DAYS_OPTIONS.includes(days) ? DAYS_OPTIONS : [...DAYS_OPTIONS, days].sort((x, y) => x - y);
  if (sel.dataset.sig !== values.join(',')) {
    sel.dataset.sig = values.join(',');
    sel.replaceChildren(...values.map((v) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v === 0 ? 'Tudo' : `${int0.format(v)} dias`;
      return o;
    }));
  }
  sel.value = String(days);
}

function refreshSelection() {
  let total = 0;
  const cleanable = state.cats.filter(isCleanable);
  for (const c of cleanable) {
    const li = cardEl(c.id);
    const on = state.selected.has(c.id);
    li.classList.toggle('on', on);
    li.classList.toggle('off', !on);
    const a = state.info[c.id];
    if (on && a?.found && (!a.blockedReason || c.requiresBrowserQuit) && !a.accessIssue && !a.settings?.measurementError) total += a.bytes;
  }
  state.total = total;
  $('totalSel').textContent = fmt(total);
  $('totalLabel').textContent = state.dryRun ? 'Seria liberado' : 'Será liberado';
  $('cleanBtn').disabled = state.busy || actionableIds().length === 0;
  $('toggleAll').textContent = cleanable.every(c=>state.selected.has(c.id)) ? 'Desmarcar tudo' : 'Marcar tudo';
  const selectable = cleanable.filter((c) => !cardEl(c.id).querySelector('input').disabled);
  $('toggleAll').textContent = selectable.length && selectable.every((c) => state.selected.has(c.id))
    ? 'Desmarcar tudo' : 'Marcar tudo';
}

// Fonte única de "sem permissão": o accessIssue que cada card recebeu na última análise.
// O banner é só um reflexo disso (não há outra checagem de permissão).
const deniedCats = () => state.cats.filter((c) => state.info[c.id]?.accessIssue);

function renderBanner() {
  const denied = deniedCats();
  const automation = denied.some(c => state.info[c.id]?.settings?.permissionKind === 'automation');
  const afterUpdate = state.updatePermission && !automation;
  $('permBanner').hidden = denied.length === 0 && !afterUpdate;
  $('permBanner').dataset.tip = denied.map((c) => c.label).join(', ');
  $('permBanner').dataset.permission = automation ? 'automation' : 'fullDisk';
  $('permText').textContent = automation ? 'A Lixeira precisa de autorização para controlar o Finder'
    : denied.length ? 'Algumas pastas precisam de Acesso Total ao Disco'
      : 'Depois da atualização, o CalangoClean precisa de Acesso Total ao Disco de novo';
}

async function analyzeAll({ manual = false } = {}) {
  const seq = ++runSeq;
  $('result').hidden = true;
  $('refreshBtn').disabled = true;
  for (const c of state.cats) {
    cardEl(c.id).querySelector('.cat-size').innerHTML = '<span class="skeleton"></span>';
  }
  state.selected = new Set(state.cats.filter((c) => isCleanable(c) && c.enabled).map((c) => c.id));
  const [disk] = await Promise.all([
    window.limpa.diskInfo(),
    ...state.cats.map((c) => window.limpa.analyze(c.id)
      .catch(() => ({ id: c.id, found: false, bytes: 0 }))
      .then((a) => { if (seq === runSeq) applyAnalysis(a); })),
  ]);
  if (seq !== runSeq) return; // uma análise mais nova assumiu
  renderDisk(disk);
  $('refreshBtn').disabled = false;
  if(manual)taskComplete();
}

function renderResult({ dryRun, results }) {
  const total = results.reduce((s, r) => s + r.freedBytes, 0);
  const label = (id) => state.cats.find((c) => c.id === id)?.label ?? id;
  const box = $('result');
  box.hidden = false;
  box.innerHTML = '<h3></h3><ul></ul>';
  const h = box.querySelector('h3');
  const incomplete = results.some(r => r.status === 'partial' || r.status === 'failed' || r.skipped);
  h.className = dryRun ? '' : incomplete ? 'incomplete' : 'done';
  h.textContent = dryRun ? `Simulação: ${fmt(total)} seriam liberados`
    : incomplete ? `${fmt(total)} liberados · Limpeza incompleta` : `${fmt(total)} liberados`;
  if (dryRun) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'nada apagado';
    h.appendChild(tag);
  }
  const ul = box.querySelector('ul');
  for (const r of results) {
    const li = document.createElement('li');
    if (r.skipped || r.status === 'partial' || r.status === 'failed') li.className = 'skipped';
    const name = document.createElement('span');
    name.textContent = label(r.id);
    const val = document.createElement('b');
    const reason = r.userMessage || simpleCleanReason(r.reason);
    val.textContent = r.skipped ? reason : fmt(r.freedBytes) +
      (reason && reason !== 'simulação' ? ` · ${reason}` : '');
    li.append(name, val);
    if(r.userMessage && r.reason || hasTechnicalReason(r.reason)) {
      const details=document.createElement('details');details.className='result-details';
      const summary=document.createElement('summary');summary.textContent='Ver detalhes';
      const text=document.createElement('p');text.textContent=r.reason;
      details.append(summary,text);li.append(details);
    }
    ul.appendChild(li);
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function confirmClean() {
  const ids = actionableIds();
  if (!ids.length || state.busy) return;
  const verb = state.dryRun ? 'Simular a limpeza de' : 'Apagar';
  const hasAttention = ids.some((id) => state.cats.find((c) => c.id === id)?.level === 'atencao');
  const emptyTrash = ids.includes('trashOld') && state.info.trashOld?.settings?.days === 0;
  const browserIds = ids.filter((id) => state.cats.find((c) => c.id === id)?.requiresBrowserQuit);
  const names = [...new Set(browserIds.flatMap((id) => state.info[id]?.settings?.runningBrowsers || []).map((b) => b.name))];
  const closeBrowsers = !state.dryRun && names.length > 0;
  state.confirmedClean = { ids, expectedDryRun: state.dryRun, closeBrowsers,
    expectedRevision: state.info.trashOld?.mutationRevision };
  $('confirmText').innerHTML = `${verb} <b>${fmt(state.total)}</b> em ${categorias(ids.length)}?` +
    (state.dryRun ? ' Nada será apagado (modo simulação).'
      : ' Isso não pode ser desfeito.' + (hasAttention ? ' Inclui itens que pedem atenção.' : '') +
        (emptyTrash ? ' A Lixeira será esvaziada por completo.' : ''));
  const warning = $('confirmBrowsers');
  warning.hidden = !closeBrowsers;
  warning.textContent = closeBrowsers
    ? `Para limpar o cache, os navegadores abertos serão fechados${names.length ? ` (${names.join(', ')})` : ''}. Salve seu trabalho e conclua os downloads antes de continuar. Se algum navegador não fechar, seu cache será mantido.`
    : '';
  const otherIds = ids.filter(id=>!browserIds.includes(id));
  const withoutBrowsers = otherIds.reduce((sum,id)=>sum+(state.info[id]?.bytes||0),0);
  $('confirmSkipBrowser').hidden = !closeBrowsers;
  $('confirmSkipBrowser').disabled = !otherIds.length;
  $('confirmSkipHint').hidden = !closeBrowsers;
  $('confirmSkipHint').textContent = otherIds.length
    ? `Sem fechar os navegadores, a limpeza ignora seus caches e processa ${fmt(withoutBrowsers)} em ${categorias(otherIds.length)}.`
    : 'Somente o cache dos navegadores está selecionado. Selecione outra categoria para limpar sem fechá-los.';
  $('confirmOk').textContent = state.dryRun ? 'Simular' : closeBrowsers ? 'Fechar e limpar' : 'Limpar';
  $('confirm').hidden = false;
  for(const child of document.querySelector('.app')?.children||[]){if(child!==$('confirm'))child.inert=true;}
  $('confirmOk').focus();
}

function closeCleanConfirmation() {
  $('confirm').hidden=true;state.confirmedClean=null;
  for(const child of document.querySelector('.app')?.children||[]){child.inert=false;}
  $('cleanBtn').focus();
}

async function runClean(skipBrowsers = false) {
  const confirmation = state.confirmedClean;
  closeCleanConfirmation();
  if (!confirmation?.ids.length || state.busy) return;
  if (skipBrowsers === true) {
    confirmation.ids = confirmation.ids.filter(id=>!state.cats.find(cat=>cat.id===id)?.requiresBrowserQuit);
    confirmation.closeBrowsers = false;
    confirmation.skipBrowsers = true;
    if(!confirmation.ids.length)return;
  }
  const { ids, ...consent } = confirmation;
  state.busy = true;
  $('cleanBtn').classList.add('busy');
  $('cleanBtn').disabled = true;
  try {
    const out = await window.limpa.clean(ids, consent);
    renderResult(out);
    if (!out.dryRun) {
      renderDisk(await window.limpa.diskInfo());
      await Promise.all(state.cats.map((c) => window.limpa.analyze(c.id).then(applyAnalysis)));
    }
    if(out.results.some(result=>!result.skipped&&result.status!=='failed'))taskComplete();
  } catch (e) {
    renderResult({ dryRun: state.dryRun, results: [{
      id: 'clean', freedBytes: 0, skipped: true, status: 'failed',
      reason: e.message || 'Não foi possível concluir a limpeza. Analise novamente.',
    }] });
  } finally {
    state.busy = false;
    $('cleanBtn').classList.remove('busy');
    refreshSelection();
  }
}

// ---- Chips: discos externos e rede ----
// Uma linha de chips compactos abaixo do Macintosh HD. Clicar num chip abre os detalhes logo abaixo;
// clicar de novo fecha; só um aberto por vez. Discos externos são somente leitura (só dá para ejetar).
const ejecting = new Set(); // ids em processo de ejeção
const ejectErrors = new Map(); // id -> mensagem amigável
const mbps = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ms0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
let testing = false;
let netInfo = null;
let btDevices = [];
let openChip = null; // 'net' ou o id de um volume
let networkExpanded = false;
let bluetoothExpanded = false;
const volumeViews = new Map();
let chipSig = '';
let detailSig = '';

function fmtSpeed(v) {
  return v >= 1000 ? `${mbps.format(v / 1000)} Gbps` : `${mbps.format(v)} Mbps`;
}

function netIcon(n) {
  if (!n || !n.connected) return 'wifiSlash';
  return { wifi: 'wifi', ethernet: 'ethernet' }[n.type] || 'globe';
}

// Anel de bateria (SVG 22 px) em volta do ícone; vermelho abaixo de 20%.
const RING_R = 9.5;
const RING_C = 2 * Math.PI * RING_R;
function ringSvg(pct) {
  const dash = (RING_C * pct) / 100;
  return `<svg class="ring" viewBox="0 0 22 22" aria-hidden="true"><circle class="ring-bg" cx="11" cy="11" r="${RING_R}"/>` +
    `<circle class="ring-fg" cx="11" cy="11" r="${RING_R}" stroke-dasharray="${dash.toFixed(2)} ${RING_C.toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`;
}

function btIcon(kind) {
  return { keyboard: 'keyboard', mouse: 'mouse', trackpad: 'mouse', headphones: 'headphones', gamepad: 'gameController' }[kind] || 'bluetooth';
}

// Linha de status única: [discos externos] [rede] [ícones Bluetooth]. Nunca quebra de linha.
function chipEl(c) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip${openChip === c.key ? ' open' : ''}${c.busy ? ' busy' : ''}${c.warn ? ' warn' : ''}${c.off ? ' off' : ''}`;
  b.dataset.key = c.key;
  b.dataset.tip = c.tip;
  b.setAttribute('aria-expanded', String(openChip === c.key));
  b.innerHTML = `<span class="chip-ico">${svg(c.icon)}</span><span class="chip-name"></span>`;
  b.querySelector('.chip-name').textContent = c.text; // vem do disco/rede: sempre textContent
  b.addEventListener('click', () => {
    const fromClean = state.view !== 'devices';
    openChip = c.key;
    activateView('devices');
    if (c.key === 'net') { networkExpanded = fromClean || !networkExpanded; renderDetail(); }
    else void toggleExternalVolume(c.key);
    renderChips();
  });
  return b;
}

// Bluetooth: só o ícone do tipo, com anel de bateria; nome e percentual ficam no tooltip. Informativo.
function btEl(d) {
  const el = document.createElement('span');
  const low = d.battery !== null && d.battery < 20;
  el.className = `bt${d.battery === null ? ' nodata' : ''}${low ? ' low' : ''}`;
  el.dataset.tip = btLine(d);
  el.setAttribute('aria-label', btLine(d));
  el.innerHTML = `<span class="bt-ico">${d.battery === null ? '' : ringSvg(d.battery)}${svg(btIcon(d.kind))}</span>`;
  if (d.battery !== null) {
    const t = document.createElement('span');
    t.className = 'bt-pct';
    t.textContent = `${d.battery}%`;
    el.append(t);
  }
  return el;
}

const btLine = (d) => `${d.name} · ${d.battery === null ? 'sem dados da bateria' : `${d.battery}%${d.battery < 20 ? ' (baixa)' : ''}`}`;

function renderChips() {
  // disco que saiu: fecha o detalhe dele
  if (openChip && openChip !== 'net' && !state.volumes.some((v) => v.id === openChip)) openChip = null;

  const items = state.volumes.map((v) => ({
    key: v.id,
    icon: v.kind === 'usb' ? 'usb' : 'hardDrives',
    text: fmt(v.free),
    warn: ejectErrors.has(v.id),
    tip: `${v.name} · ${fmt(v.free)} livres · ${v.format} · ${v.path}${v.protocol ? ` · ${v.protocol}` : ''}${v.writable ? '' : ' · somente leitura'}`,
  }));
  const n = netInfo;
  items.push({
    key: 'net',
    icon: netIcon(n),
    text: testing ? 'Testando…' : !n ? 'Rede' : n.connected ? n.label : 'Sem conexão',
    busy: testing,
    off: Boolean(n) && !n.connected,
    tip: !n ? 'Rede'
      : n.connected
        ? `${n.label}${n.name ? ` · ${n.name}` : ''}${n.ip ? ` · ${n.ip}` : ''} (${n.interface})${n.ssidHidden ? '. O macOS oculta o nome da rede Wi-Fi sem permissão de Localização.' : ''}`
        : 'Nenhuma conexão de rede ativa.',
  });

  const sig = JSON.stringify([items, btDevices, openChip]);
  if (sig !== chipSig) {
    chipSig = sig;
    const row = $('chips');
    // Rede primeiro: o chip dela nunca é empurrado para fora da linha; discos depois; Bluetooth por último.
    const net = items.filter((i) => i.key === 'net');
    row.replaceChildren(...[...net, ...items.filter((i) => i.key !== 'net')].map(chipEl));
    fitBluetooth(row);
  }
  renderDetail();
  renderDeviceList();
}

function renderDeviceList() {
  const list = $('deviceVolumes');
  if (!list) return;
  const rows = state.volumes.map(v => {
    const view = volumeView(v);
    const signature=JSON.stringify([v,ejecting.has(v.id),ejectErrors.get(v.id)||'',view.open,view.busy,view.result,view.error]);
    const existing=[...list.children].find(card=>card.dataset.volumeId===v.id);
    if(existing?.dataset.signature===signature)return existing;
    const card = document.createElement('section'); card.className='device-volume-card card';
    card.dataset.volumeId=v.id;
    card.dataset.signature=signature;
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'device-fold-toggle';
    toggle.setAttribute('aria-expanded', String(view.open));
    const name = document.createElement('span'); name.textContent = v.name;
    const caption = document.createElement('span'); caption.className = 'device-fold-caption'; caption.textContent = `${fmt(v.free)} livres`;
    const caret = document.createElement('span'); caret.className = 'device-fold-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = '⌄';
    toggle.append(name, caption, caret); toggle.addEventListener('click', () => { void toggleExternalVolume(v.id); });
    const body = document.createElement('div'); body.className = 'device-volume-body'; body.hidden = !view.open;
    body.id = `volumeDetail-${v.id}`; toggle.setAttribute('aria-controls', body.id);
    body.append(buildVolumeDetail(v), buildExternalChart(v, view));
    card.append(toggle, body); return card;
  });
  if(!rows.length){const p=document.createElement('p');p.className='view-note';p.textContent='Nenhum disco externo conectado.';rows.push(p);}
  if(rows.length!==list.children.length||rows.some((row,index)=>list.children[index]!==row))list.replaceChildren(...rows);
  const bt = $('btDetails'); if(!bt)return;
  bt.hidden = !bluetoothExpanded;
  $('showBluetooth').setAttribute('aria-expanded', String(bluetoothExpanded));
  $('bluetoothFoldLabel').textContent = `${btDevices.length} ${btDevices.length === 1 ? 'dispositivo' : 'dispositivos'}`;
  bt.replaceChildren(...btDevices.map(device=>{const li=document.createElement('li');li.innerHTML=`<span class="device-bt-icon">${svg(btIcon(device.kind))}</span><span></span>`;li.lastElementChild.textContent=btLine(device);li.classList.toggle('low',device.battery!==null&&device.battery<20);return li;}));
  if(!btDevices.length){const li=document.createElement('li');li.textContent='Nenhum aparelho Bluetooth conectado.';bt.append(li);}
}

function volumeView(volume) {
  const signature = JSON.stringify([volume.path, volume.uuid]);
  if (volumeViews.get(volume.id)?.signature !== signature) {
    if (volumeViews.get(volume.id)?.busy) void window.limpa.cancelVolumeFolders(volume.id);
    volumeViews.set(volume.id, { signature, open: false, busy: false, loaded: false, result: null, error: '' });
  }
  return volumeViews.get(volume.id);
}

async function toggleExternalVolume(id) {
  const volume = state.volumes.find(item => item.id === id);
  if (!volume) return;
  const view = volumeView(volume);
  view.open = !view.open;
  renderDeviceList();
  if (!view.open) { if (view.busy) void window.limpa.cancelVolumeFolders(id); return; }
  if (!view.loaded) {
    view.loaded = true;
    try { const cached = await window.limpa.lastVolumeFolders(id); if (volumeViews.get(id) !== view) return; if (cached.ok) view.result = cached.result; else view.error = cached.error; }
    catch { view.error = 'Não foi possível consultar a última análise.'; }
    if (view.open && !view.result && !view.error) { await analyzeExternalVolume(id); return; }
    renderDeviceList();
  }
}

async function analyzeExternalVolume(id) {
  const volume = state.volumes.find(item => item.id === id);
  if (!volume) return;
  const view = volumeView(volume);
  if (view.busy) return;
  view.busy = true; view.error = ''; renderDeviceList();
  let result;
  try { result = await window.limpa.analyzeVolumeFolders(id); }
  catch { result = { ok: false, error: 'Não foi possível analisar o disco. Tente novamente.' }; }
  if (volumeViews.get(id) !== view || !state.volumes.some(item => item.id === id)) return;
  view.busy = false;
  if (result.ok) { view.result = result.result; taskComplete(); }
  else if (!result.cancelled) view.error = result.error;
  renderDeviceList();
}

function buildExternalChart(volume, view) {
  const section = document.createElement('section'); section.className = 'external-folders';
  section.setAttribute('aria-label', `Ocupação por pastas de ${volume.name}`);
  if (view.result) {
    const palette = Object.values(FOLDER_COLORS);
    const items = view.result.items.map((item, index) => ({ ...item, color: item.id === 'undetailed' ? '#6b7280' : palette[index % palette.length] }));
    const body = document.createElement('div'); body.className = 'dd-body';
    const chart = document.createElement('div'); chart.className = 'donut';
    chart.innerHTML = donutSvg(items, Math.max(view.result.used, items.reduce((total, item) => total + item.bytes, 0)), view.result.used);
    const legend = document.createElement('ul'); legend.className = 'dd-list external-legend';
    for (const item of items) {
      const row = document.createElement('li');
      const swatch = document.createElement('i'); swatch.className = 'sw'; swatch.style.background = item.color;
      const label = document.createElement('span'); label.className = 'dl'; label.textContent = `${item.label}${item.partial ? ' (parcial)' : ''}`; label.title = label.textContent;
      const size = document.createElement('b'); size.className = 'ds'; size.textContent = fmt(item.bytes);
      row.append(swatch, label, size); legend.append(row);
    }
    body.append(chart, legend); section.append(body);
    const note = document.createElement('p'); note.className = `view-note${view.result.partial ? ' detail-error' : ''}`; note.textContent = view.result.note; section.append(note);
  }
  const footer = document.createElement('div'); footer.className = 'dd-foot';
  const status = document.createElement('span'); status.setAttribute('role', 'status');
  status.textContent = view.busy ? 'Analisando pastas…' : view.result ? `Última análise: ${whenFmt.format(new Date(view.result.at))}` : 'O gráfico será gerado ao analisar.';
  const action = document.createElement('button'); action.type = 'button'; action.className = 'link';
  action.textContent = view.busy ? 'Cancelar' : view.result ? 'Analisar de novo' : 'Analisar';
  action.addEventListener('click', () => { if (view.busy) void window.limpa.cancelVolumeFolders(volume.id); else void analyzeExternalVolume(volume.id); });
  footer.append(status, action); section.append(footer);
  if (view.error) { const error = document.createElement('p'); error.className = 'detail-error'; error.setAttribute('role', 'status'); error.textContent = view.error; section.append(error); }
  return section;
}

// Põe os ícones de Bluetooth que couberem; o resto vira "+N" com tooltip listando os aparelhos.
function fitBluetooth(row) {
  if (!btDevices.length) return;
  const wrap = document.createElement('span');
  wrap.className = 'bt-group';
  row.append(wrap);
  const overflow = () => row.scrollWidth > row.clientWidth + 0.5;
  let shown = 0;
  for (const d of btDevices) {
    wrap.append(btEl(d));
    shown++;
    if (overflow()) { wrap.lastChild.remove(); shown--; break; }
  }
  // sobra: reserva espaço para o "+N", tirando ícones até caber
  const place = () => {
    const rest = btDevices.slice(shown);
    wrap.querySelector('.bt-more')?.remove();
    if (!rest.length) return true;
    const more = document.createElement('span');
    more.className = 'bt-more';
    more.textContent = `+${rest.length}`;
    more.dataset.tip = rest.map(btLine).join('\n');
    wrap.append(more);
    return !overflow();
  };
  while (!place() && shown > 0) { wrap.querySelectorAll('.bt').item(--shown).remove(); }
}

function buildVolumeDetail(v) {
  const el = document.createElement('div');
  el.className = 'vd';
  el.innerHTML = `
    <div class="vd-head"><span class="meta"></span><span><b class="free"></b> disponível</span></div>
    <div class="bar"><i></i></div>
    <div class="vd-foot">
      <span>Usado <b class="u"></b> / Total <b class="t"></b></span>
      <button class="mini vol-eject">${svg('eject')}<span>Ejetar</span></button>
    </div>
    <div class="vol-err" hidden></div>`;
  el.querySelector('.meta').textContent = `${v.format}${v.protocol ? ` · ${v.protocol}` : ''}`;
  el.querySelector('.free').textContent = fmt(v.free);
  el.querySelector('.u').textContent = fmt(v.used);
  el.querySelector('.t').textContent = fmt(v.total);
  el.querySelector('.bar i').style.width = `${v.total ? Math.min(100, (v.used / v.total) * 100).toFixed(1) : 0}%`;
  const btn = el.querySelector('.vol-eject');
  btn.hidden = !v.ejectable;
  btn.disabled = ejecting.has(v.id);
  btn.querySelector('span').textContent = ejecting.has(v.id) ? 'Ejetando…' : 'Ejetar';
  btn.addEventListener('click', () => ejectVolume(v));
  const err = el.querySelector('.vol-err');
  err.hidden = !ejectErrors.has(v.id);
  err.textContent = ejectErrors.get(v.id) || '';
  return el;
}

function renderDetail() {
  if(state.view==='devices') {
    $('chipDetail').hidden=!networkExpanded;$('showNetwork').setAttribute('aria-expanded',String(networkExpanded));
    $('networkFoldLabel').textContent = netInfo?.connected ? netInfo.label : 'Sem conexão';
    $('detailNet').hidden=false;$('detailVol').hidden=true;detailSig='';return;
  }
  $('chipDetail').hidden = openChip === null;
  $('detailNet').hidden = openChip !== 'net';
  const isVol = openChip !== null && openChip !== 'net';
  $('detailVol').hidden = !isVol;
  if (!isVol) { detailSig = ''; return; }
  const v = state.volumes.find((x) => x.id === openChip);
  // Só refaz o detalhe quando algo mudou (evita perder o clique no Ejetar por causa de um refresh).
  const sig = JSON.stringify([v, ejecting.has(v.id), ejectErrors.get(v.id) || '']);
  if (sig === detailSig) return;
  detailSig = sig;
  $('detailVol').replaceChildren(buildVolumeDetail(v));
}

function renderVolumes(list) {
  state.volumes = list;
  const ids = new Set(list.map((v) => v.id));
  for (const [id, view] of volumeViews) if (!ids.has(id)) { if (view.busy) void window.limpa.cancelVolumeFolders(id); volumeViews.delete(id); }
  for (const id of [...ejecting]) if (!ids.has(id)) ejecting.delete(id); // disco já saiu
  for (const id of [...ejectErrors.keys()]) if (!ids.has(id)) ejectErrors.delete(id);
  renderChips();
}

async function ejectVolume(v) {
  if (ejecting.has(v.id)) return;
  ejecting.add(v.id);
  ejectErrors.delete(v.id);
  renderChips();
  let result;
  try {
    result = await window.limpa.ejectVolume(v.id);
  } catch {
    result = { ok: false, error: 'Não foi possível ejetar o disco.' };
  }
  ejecting.delete(v.id);
  if (!result.ok) {
    ejectErrors.set(v.id, result.error);
    // O motivo pode já ter passado (ex.: o programa foi fechado): a mensagem não fica velha na tela.
    setTimeout(() => {
      if (ejectErrors.delete(v.id)) renderChips();
    }, 12000);
  }
  if(result.ok)taskComplete();
  renderVolumes(await window.limpa.getVolumes().catch(() => state.volumes));
}

// ---- Gráfico do disco (clique no card do Macintosh HD) ----
// Somente leitura. A medição (du) só roda ao clicar; o último resultado fica guardado com a data.
const FOLDER_COLORS = {
  apps: '#c48bf0', documents: '#60a5fa', downloads: '#fbbf24', movies: '#fb7185',
  pictures: '#a3e635', library: '#f97316', system: '#6b7280',
};
const whenFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
let foldersData = null;
let foldersBusy = false;
let foldersLoaded = false;

function donutSvg(items, total, used = total) {
  const R = 40;
  const C = 2 * Math.PI * R;
  let off = 0;
  let arcs = '';
  for (const it of items) {
    if (it.bytes <= 0 || total <= 0) continue;
    const len = (it.bytes / total) * C;
    arcs += `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${it.color || FOLDER_COLORS[it.id] || '#6b7280'}" stroke-width="12" ` +
      `stroke-dasharray="${Math.max(0, len - 1).toFixed(2)} ${(C - Math.max(0, len - 1)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
    off += len;
  }
  return `<svg viewBox="0 0 100 100" role="img" aria-label="Divisão do espaço usado"><circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="12"/>${arcs}` +
    `<text x="50" y="48" text-anchor="middle" class="dn-big">${fmt(used)}</text><text x="50" y="60" text-anchor="middle" class="dn-sm">usados</text></svg>`;
}

function renderFolders() {
  const d = foldersData;
  $('ddProg').hidden = !foldersBusy;
  $('ddCancel').hidden = !foldersBusy;
  $('ddRun').hidden = foldersBusy;
  $('ddRun').textContent = d ? 'Analisar de novo' : 'Analisar';
  $('ddWhen').textContent = foldersBusy ? '' : d ? `Última análise: ${whenFmt.format(new Date(d.at))}` : 'Ainda não analisado';
  $('ddBody').hidden = !d;
  if (!d) return;
  const total = d.items.reduce((a, b) => a + b.bytes, 0);
  $('donut').innerHTML = donutSvg(d.items, total);
  const rows = d.items.map((it) => {
    const li = document.createElement('li');
    li.innerHTML = '<i class="sw"></i><span class="dl"></span><b class="ds"></b>';
    li.querySelector('.sw').style.background = FOLDER_COLORS[it.id] || '#6b7280';
    li.querySelector('.dl').textContent = it.partial ? `${it.label} (parcial)` : it.label;
    if (it.partial) li.dataset.tip = 'Sem Acesso Total ao Disco, as pastas Containers e Group Containers de outros apps não são lidas, então este total é parcial.';
    li.querySelector('.ds').textContent = fmt(it.bytes);
    if (it.canReveal) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dd-reveal';
      b.dataset.tip = 'Mostrar no Finder';
      b.setAttribute('aria-label', `Mostrar ${it.label} no Finder`);
      b.innerHTML = svg('folderOpen');
      b.addEventListener('click', () => window.limpa.revealFolder(it.id));
      li.append(b);
    } else {
      li.append(document.createElement('span'));
    }
    return li;
  });
  $('ddList').replaceChildren(...rows);
}

async function analyzeFolders() {
  if (foldersBusy) return;
  foldersBusy = true;
  $('folderError').hidden = true;
  renderFolders();
  let r;
  try {
    r = await window.limpa.analyzeFolders();
  } catch {
    r = { ok: false };
  }
  foldersBusy = false;
  if (r && r.ok) { foldersData = r.result;taskComplete(); }
  else if(!r?.cancelled) { $('folderError').textContent=r?.error||'Não foi possível analisar as pastas. Tente novamente.'; $('folderError').hidden=false; }
  renderFolders();
}

async function toggleDisk() {
  const fromClean = state.view !== 'devices';
  const open = fromClean || $('diskDetail').hidden;
  activateView('devices');
  $('diskDetail').hidden = !open;
  $('showFolders').setAttribute('aria-expanded', String(open));
  $('disk').setAttribute('aria-expanded', String(open));
  $('disk').classList.toggle('open', open);
  if (!open) return;
  if (!foldersLoaded) {
    foldersLoaded = true;
    foldersData = await window.limpa.lastFolders().catch(() => null);
  }
  renderFolders();
  if (!foldersData && !foldersBusy) analyzeFolders(); // primeira vez: este clique é o pedido de medir
}

async function prepareDevicePanels() {
  renderDetail();
  if(!foldersLoaded) {
    foldersLoaded=true;
    foldersData=await window.limpa.lastFolders().catch(()=>null);
  }
  renderFolders();
}

// ---- Bluetooth (chips informativos) ----
async function refreshBluetooth() {
  try {
    btDevices = await window.limpa.getBluetooth();
  } catch {
    return; // mantém o que já estava
  }
  renderChips();
}

// ---- Rede (detalhe do chip) ----
// A leitura é leve e se repete sozinha. O teste de velocidade SÓ roda por clique no botão.
function renderNetwork(n) {
  netInfo = n;
  $('netIco').innerHTML = svg(netIcon(n));
  $('netIco').classList.toggle('off', !n.connected);
  $('netType').textContent = n.connected ? n.label : 'Sem conexão';
  // O macOS esconde o nome da rede Wi-Fi sem permissão de Localização: mostra só "Wi-Fi".
  $('netName').textContent = n.connected && n.name ? n.name : n.connected ? `(${n.interface})` : '';
  $('netIp').textContent = n.connected && n.ip ? n.ip : '--';
  $('speedBtn').disabled = testing || !n.connected;
  renderChips();
}

async function refreshNetwork() {
  try {
    renderNetwork(await window.limpa.getNetwork());
  } catch { /* mantém o que está na tela */ }
}

async function runSpeedTest() {
  if (testing) return;
  testing = true;
  $('speedBtn').disabled = true;
  $('speedLabel').textContent = 'Testando…';
  $('speedProg').hidden = false;
  $('speedErr').hidden = true;
  $('speedResult').hidden = true;
  renderChips(); // o chip mostra "Testando…" mesmo com o detalhe fechado
  let r;
  try {
    r = await window.limpa.runSpeedTest();
  } catch {
    r = { ok: false, error: 'Não foi possível executar o teste de velocidade.' };
  }
  testing = false;
  $('speedProg').hidden = true;
  $('speedLabel').textContent = 'Testar velocidade';
  if (r.ok) {
    taskComplete();
    $('spDown').textContent = fmtSpeed(r.downMbps);
    $('spUp').textContent = fmtSpeed(r.upMbps);
    $('spLat').textContent = r.latencyMs == null ? '--' : `${ms0.format(r.latencyMs)} ms`;
    $('speedResult').hidden = false;
  } else {
    $('speedErr').textContent = r.error;
    $('speedErr').hidden = false;
  }
  refreshNetwork();
}

// ---- Agendamento ----
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const lastFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function renderSchedule(v) {
  $('schedOn').checked = v.enabled;
  $('schedControls').hidden = !v.enabled;
  $('schedDay').value = String(v.weekday);
  $('schedTime').value = hhmm(v.hour, v.minute);
  const last = v.last ? ` · Última limpeza: ${lastFmt.format(new Date(v.last))}` : '';
  $('schedSummary').textContent = v.enabled
    ? `${DIAS[v.weekday][0].toUpperCase()}${DIAS[v.weekday].slice(1)} às ${hhmm(v.hour, v.minute)}${last}`
    : 'Desligado';
  $('schedLast').textContent = v.last ? `Última limpeza: ${lastFmt.format(new Date(v.last))}` : 'Nenhuma limpeza real registrada.';
  $('sched').dataset.tip = 'Roda sozinho só as categorias de nível Seguro que estiverem marcadas, ' +
    `com no mínimo ${v.minDaysBetween} dias entre execuções.` +
    (v.dryRun ? ' Modo simulação ligado: nada será apagado.' : '');
  $('schedErr').hidden = !v.error;
  $('schedErr').textContent = v.error || '';
}

async function saveSchedule(patch) {
  for (const id of ['schedOn', 'schedDay', 'schedTime']) $(id).disabled = true;
  try {
    renderSchedule(await window.limpa.setSchedule(patch));
  } catch (e) {
    renderSchedule({ ...(await window.limpa.getSchedule()), error: 'Falha ao salvar o agendamento.' });
  } finally {
    for (const id of ['schedOn', 'schedDay', 'schedTime']) $(id).disabled = false;
  }
}

let updating = false;
function renderUpdates(v) {
  const version=state.version||v.current||'';
  $('appVersion').textContent = version?`v${version}`:'';
  $('appVersion').dataset.tip=version?`CalangoClean — versão ${version}`:'';
  $('settingsVersion').textContent=version?`Versão ${version}`:'';
  if (updating) return;
  $('updateBanner').hidden = !v.available;
  $('updateBanner').classList.remove('err');
  $('updateProgress').hidden = true;
  $('updateInstall').disabled = false;
  $('updateInstall').textContent = 'Atualizar';
  $('updateText').textContent = v.available ? `Nova versão ${v.available.version} disponível` : '';
}

const UPDATE_PHASES = { download: 'Baixando', verify: 'Verificando SHA-256…', mount: 'Preparando o instalador…', restart: 'Reiniciando para concluir…' };
function renderUpdateProgress(p) {
  if (!p || !UPDATE_PHASES[p.phase]) return;
  const bar = $('updateProgress');
  bar.hidden = false;
  const indeterminate = p.phase !== 'download';
  bar.classList.toggle('indeterminate', indeterminate);
  const pct = indeterminate ? 100 : Math.max(0, Math.min(100, Number(p.percent) || 0));
  $('updateBar').style.width = indeterminate ? '' : `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  $('updateText').textContent = p.phase === 'download' ? `Baixando atualização… ${pct}%` : UPDATE_PHASES[p.phase];
}

async function installUpdate() {
  if (updating) return;
  updating = true;
  $('updateInstall').disabled = true;
  $('updateBanner').classList.remove('err');
  renderUpdateProgress({ phase: 'download', percent: 0 });
  let result;
  try { result = await window.limpa.installUpdate(); }
  catch { result = { ok: false, error: 'Não foi possível atualizar. A versão atual foi mantida.' }; }
  if (result?.ok) return; // o app se encerra e o script auxiliar conclui a troca
  updating = false;
  $('updateProgress').hidden = true;
  $('updateBanner').classList.add('err');
  $('updateText').textContent = result?.error || 'Não foi possível atualizar. A versão atual foi mantida.';
  $('updateInstall').disabled = false;
  $('updateInstall').textContent = 'Tentar de novo';
  $('updateStatus').hidden = false;
  $('updateStatus').textContent = $('updateText').textContent;
}

async function main() {
  setupCompactLayout();
  window.limpa.onEscape?.(()=>{
    if(!$('confirm').hidden){closeCleanConfirmation();return;}
    if(applicationsTool?.cancelConfirmation())return;
    if(performanceTool?.handleEscape())return;
    window.limpa.hide();
  });
  window.limpa.onAppearance(applyAppearance);
  const init = await window.limpa.init();
  state.version=typeof init.version==='string'?init.version:init.updates?.current||'';
  applyAppearance(init);
  const applySound=enabled=>{$('soundEnabled').checked=enabled;$('soundPreview').disabled=!enabled;};
  applySound(init.soundEnabled!==false);
  $('soundEnabled').addEventListener('change',async()=>{
    const input=$('soundEnabled');const before=!input.checked;input.disabled=true;
    try {
      const result=await window.limpa.setCompletionSound(input.checked);
      if(!result?.ok)throw new Error(result?.error||'Não foi possível salvar a preferência de som.');
      applySound(result.enabled);
    } catch(error) {applySound(before);showStatus(error.message||'Não foi possível salvar a preferência de som.');}
    finally {input.disabled=false;}
  });
  $('soundPreview').addEventListener('click',taskComplete);
  $('appearanceSelect').addEventListener('change',async()=>{
    const before=state.appearance;const select=$('appearanceSelect');select.disabled=true;
    try{const result=await window.limpa.setAppearance(select.value);applyAppearance(result);if(!result.ok)showStatus(result.error||'Não foi possível salvar a aparência.');}
    catch{applyAppearance(before);showStatus('Não foi possível salvar a aparência. A escolha anterior foi mantida.');}
    finally{select.disabled=false;}
  });
  state.dryRun = init.dryRun;
  state.cats = init.categories;
  renderUpdates(init.updates);
  window.limpa.onUpdates(renderUpdates);
  $('updateCheck').addEventListener('click', async () => {
    $('updateCheck').disabled = true;
    $('updateStatus').hidden = false;
    $('updateStatus').textContent = 'Verificando…';
    try {
      const v = await window.limpa.checkUpdates();
      renderUpdates(v);
      $('updateStatus').textContent = v.error || (v.available ? 'Nova versão disponível. Clique em Atualizar no topo do painel.' : 'Você está na versão mais recente.');
    } catch { $('updateStatus').textContent = 'Não foi possível verificar atualizações. Tente novamente.'; }
    finally { $('updateCheck').disabled = false; }
  });
  $('updateInstall').addEventListener('click', installUpdate);
  window.limpa.onUpdateProgress?.(renderUpdateProgress);
  if (init.updateResult) {
    const r = init.updateResult;
    showStatus(r.ok ? `CalangoClean atualizado para a versão ${r.to}.`
      : `A atualização para a versão ${r.to} não foi concluída: ${r.error || 'erro desconhecido'}. A versão ${r.from} foi mantida.`);
    // Trocar o app pode invalidar o Acesso Total ao Disco no macOS: avisa logo na primeira abertura.
    if (r.ok && init.fullDiskAccess === false) { state.updatePermission = true; renderBanner(); }
  }
  $('simPill').hidden = !state.dryRun;
  $('ctaLabel').textContent = 'Limpar';
  hydrateIcons();
  $('machine').textContent = [init.machine?.name, init.machine?.chip].filter(Boolean).join(' · ');
  renderDisk(init.disk);
  buildList();

  $('toggleAll').addEventListener('click', () => {
    const selectable = state.cats.filter((c) => isCleanable(c) && !cardEl(c.id).querySelector('input').disabled);
    const all = selectable.every((c) => state.selected.has(c.id));
    for (const c of selectable) {
      const cb = cardEl(c.id).querySelector('input');
      cb.checked = !all;
      cb.dispatchEvent(new Event('change')); // persiste cada escolha
    }
  });
  $('cleanBtn').addEventListener('click', confirmClean);
  $('confirmOk').addEventListener('click', () => runClean());
  $('confirmSkipBrowser').addEventListener('click', () => runClean(true));
  $('confirmCancel').addEventListener('click', closeCleanConfirmation);
  document.addEventListener('keydown',event=>{
    if($('confirm').hidden)return;
    if(event.key==='Escape'){event.preventDefault();closeCleanConfirmation();return;}
    if(event.key==='Tab'){
      const buttons=[...$('confirm').querySelectorAll('button:not(:disabled)')].filter(button=>!button.hidden);
      const first=buttons[0],last=buttons.at(-1);if(!first)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  $('refreshBtn').addEventListener('click', () => analyzeAll({ manual: true }));
  $('photosBtn').addEventListener('click', async () => {
    $('photosBtn').disabled = true;
    try { await window.limpa.openPhotos(); }
    catch (e) {
      $('updateStatus').hidden = false;
      $('updateStatus').textContent = e.message || 'Não foi possível abrir a busca de duplicados.';
    } finally { $('photosBtn').disabled = false; }
  });
  window.limpa.onPhotosChanged(() => {
    // A confirmação antiga da Lixeira não vale depois de receber novas fotos.
    if(!$('confirm').hidden)closeCleanConfirmation();
    else state.confirmedClean = null;
    window.limpa.analyze('trashOld').then(applyAnalysis).catch(() => {});
    window.limpa.diskInfo().then(renderDisk).catch(() => {});
  });
  $('infoToggle').addEventListener('click', toggleInfos);
  $('permBtn').addEventListener('click', () => { window.limpa.openPrivacy($('permBanner').dataset.permission); state.updatePermission = false; });
  // Ao voltar dos Ajustes, reanalisa para o aviso sumir sozinho.
  window.addEventListener('focus', () => { if (deniedCats().length && !state.busy && !$('refreshBtn').disabled) analyzeAll(); });
  $('quitBtn').addEventListener('click', () => window.limpa.quit());
  window.limpa.onShown(() => {
    performanceTool?.setVisible?.(true);
    window.limpa.getVolumes().then(renderVolumes).catch(() => {});
    if (!testing) refreshNetwork();
    refreshBluetooth();
    if (!state.busy) analyzeAll();
  });
  window.limpa.onHidden?.(() => { performanceTool?.setVisible?.(false); });

  window.limpa.getVolumes().then(renderVolumes).catch(() => {});
  window.limpa.onVolumes(renderVolumes);
  refreshNetwork();
  refreshBluetooth();
  setInterval(() => { if (!document.hidden && !testing) refreshNetwork(); }, 10000);
  setInterval(() => { if (!document.hidden) refreshBluetooth(); }, 30000);
  $('speedBtn').addEventListener('click', runSpeedTest);
  $('disk').addEventListener('click', toggleDisk);
  $('disk').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDisk(); } });
  $('ddRun').addEventListener('click', analyzeFolders);
  $('ddCancel').addEventListener('click', () => window.limpa.cancelFolders());
  $('creditBtn').addEventListener('click', () => window.limpa.openSite());
  window.limpa.getSchedule().then(renderSchedule).catch(() => {});
  $('schedOn').addEventListener('change', () => saveSchedule({ enabled: $('schedOn').checked }));
  $('schedDay').addEventListener('change', () => saveSchedule({ weekday: Number($('schedDay').value) }));
  $('schedTime').addEventListener('change', () => {
    const [h, m] = $('schedTime').value.split(':').map(Number);
    if (Number.isInteger(h) && Number.isInteger(m)) saveSchedule({ hour: h, minute: m });
  });

  analyzeAll();
}

main();
