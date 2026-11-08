'use strict';

const $ = (id) => document.getElementById(id);
function applyAppearance(view) {
  if (!view || !['light', 'dark'].includes(view.colorScheme)) return;
  document.documentElement.style.colorScheme = view.colorScheme;
  document.documentElement.dataset.appearance = ['normal', 'noturno', 'automatico'].includes(view.appearance) ? view.appearance : 'automatico';
}
const ICONS = {
  search: '<circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.5 4.5"/>',
  shield: '<path d="M12 3 4 6v6c0 4.4 8 9 8 9s8-4.6 8-9V6l-8-3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z"/>',
  images: '<rect x="6" y="3" width="15" height="15" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12M7 15l4-5 4 4 2-2 3 4"/><circle cx="16.5" cy="7.5" r="1"/>',
  document: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4V8Z"/>',
  audio: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  archive: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M9 3v2m0 2v2m0 2v2m0 2v3h3v-3H9Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  warning: '<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17v.1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

function icon(name) {
  const node = document.createElement('span');
  node.setAttribute('aria-hidden', 'true');
  node.className = 'inline-icon';
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.images}</svg>`;
  return node;
}

for (const element of document.querySelectorAll('[data-icon]')) element.append(icon(element.dataset.icon));

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dates = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
function size(bytes) {
  if (!(bytes > 0)) return '0 B';
  let unit = Math.min(4, Math.floor(Math.log10(bytes) / 3));
  if (Number((bytes / 1000 ** unit).toFixed(1)) >= 1000 && unit < 4) unit++;
  return `${unit ? decimal.format(bytes / 1000 ** unit) : nf.format(bytes)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
function count(n, singular, plural) { return `${nf.format(n)} ${n === 1 ? singular : plural}`; }
function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Data indisponível' : dates.format(d); }
function displayPath(filename) {
  const root = state.roots.filter(item => filename.startsWith(item.path + '/')).sort((a, b) => b.path.length - a.path.length)[0];
  return root ? `${root.label}/${filename.slice(root.path.length + 1)}` : filename;
}

const state = { mode: 'photos', roots: [], selectedRoots: new Set(), snapshot: null, activeGroup: null, selected: new Set(), dryRun: true, busy: null, ready: false, pending: null, result: null };
const rootSelections = new Map();
const isPhotoMode = () => state.mode === 'photos';
const modeTitle = () => isPhotoMode() ? 'Fotos duplicadas' : 'Arquivos duplicados';
const itemWord = () => isPhotoMode() ? 'foto' : 'arquivo';
const itemsWord = () => isPhotoMode() ? 'fotos' : 'arquivos';
const thumbnails = new Map();
const thumbnailRequests = new Map();
const thumbnailQueue = [];
let thumbnailWorkers = 0;

function error(message) { $('errorText').textContent = message; $('errorNotice').hidden = !message; }
function announce(message) { $('liveStatus').textContent = message; }
function groups() { return Array.isArray(state.snapshot?.groups) ? state.snapshot.groups : []; }
function groupFor(id) { return groups().find((group) => group.id === id); }
function files() { return groups().flatMap((group) => group.files); }
function selectedFiles() { return files().filter((file) => state.selected.has(file.id)); }

async function loadThumbnail(id) {
  const mode = state.mode;
  const key = `${mode}:${id}`;
  if (thumbnails.has(key)) return thumbnails.get(key);
  if (thumbnailRequests.has(key)) return thumbnailRequests.get(key);
  const request = new Promise((resolve) => { thumbnailQueue.push({ id, mode, key, resolve }); drainThumbnails(); });
  thumbnailRequests.set(key, request);
  return request;
}
function drainThumbnails() {
  while (thumbnailWorkers < 2 && thumbnailQueue.length) {
    const { id, mode, key, resolve } = thumbnailQueue.shift();
    thumbnailWorkers++;
    Promise.resolve().then(() => window.photos.thumbnail(id, mode)).then((out) => {
      const data = typeof out === 'string' ? out : out?.dataUrl;
      const safe = typeof data === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data) ? data : null;
      if (thumbnails.size >= 180) thumbnails.delete(thumbnails.keys().next().value);
      thumbnails.set(key, safe);
      resolve(safe);
    }).catch(() => { thumbnails.set(key, null); resolve(null); }).finally(() => { thumbnailRequests.delete(key); thumbnailWorkers--; drainThumbnails(); });
  }
}
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const holder = entry.target;
    thumbnailObserver.unobserve(holder);
    if (!holder.isConnected) continue;
    const fileId = holder.dataset.thumbnail;
    loadThumbnail(fileId).then((data) => {
      if (!holder.isConnected || holder.dataset.thumbnail !== fileId) return;
      if (!data) { const text = holder.querySelector('.preview-placeholder > span'); if (text) text.textContent = 'Miniatura indisponível'; return; }
      const image = document.createElement('img');
      image.alt = holder.dataset.imageName || '';
      image.src = data;
      image.draggable = false;
      const placeholder = holder.querySelector('.preview-placeholder');
      image.addEventListener('load', () => { if (placeholder) placeholder.hidden = true; });
      image.addEventListener('error', () => { image.remove(); if (placeholder) { placeholder.hidden = false; const text = placeholder.querySelector('span'); if (text) text.textContent = 'Miniatura indisponível'; } });
      holder.append(image);
    });
  }
}, { rootMargin: '120px' });

function watchThumbnail(holder, file, detailed = false) {
  if (!isPhotoMode()) {
    const kind = ['document', 'video', 'audio', 'archive'].includes(file.kind) ? file.kind : 'document';
    holder.classList.add('file-preview'); holder.dataset.kind = kind;
    const visual = document.createElement('div'); visual.className = 'file-art';
    visual.append(icon(kind));
    if (detailed) {
      const extension = document.createElement('strong'); extension.textContent = (file.extension || file.name.split('.').pop() || '').replace(/^\./, '').toUpperCase().slice(0, 10);
      const type = document.createElement('span'); type.textContent = { document: 'Documento', video: 'Vídeo', audio: 'Áudio', archive: 'Arquivo compactado' }[kind];
      visual.append(extension, type);
    }
    holder.append(visual);
    return;
  }
  holder.dataset.thumbnail = file.id;
  holder.dataset.imageName = file.name;
  const placeholder = document.createElement('div');
  placeholder.className = 'preview-placeholder';
  placeholder.append(icon('images'));
  if (detailed) { const hint = document.createElement('span'); hint.textContent = 'Carregando miniatura…'; placeholder.append(hint); }
  holder.append(placeholder);
  thumbnailObserver.observe(holder);
}

function releaseThumbnails(container) {
  for (const holder of container.querySelectorAll('[data-thumbnail]')) thumbnailObserver.unobserve(holder);
}

function invalidateSearch() {
  state.snapshot = null; state.activeGroup = null; state.selected.clear(); state.pending = null; state.result = null;
  renderGroups(); renderReview(); announce(`Pastas alteradas. Faça uma nova busca para revisar os itens de ${modeTitle().toLowerCase()}.`);
}

function renderRoots() {
  $('roots').replaceChildren(...state.roots.map((root) => {
    const label = document.createElement('label'); label.className = 'root-chip'; label.title = root.path;
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.selectedRoots.has(root.id); input.disabled = Boolean(state.busy); input.setAttribute('aria-label', `Procurar em ${root.label}`);
    input.addEventListener('change', () => { if (input.checked) state.selectedRoots.add(root.id); else state.selectedRoots.delete(root.id); invalidateSearch(); updateControls(); });
    const name = document.createElement('span'); name.className = 'root-name'; name.textContent = root.label;
    label.append(input, icon('folder'), name); return label;
  }));
}

function updateControls() {
  const busy = Boolean(state.busy);
  $('scanBtn').disabled = !state.ready || busy || state.selectedRoots.size === 0;
  $('scanLabel').textContent = state.busy === 'scan' ? 'Buscando…' : state.snapshot ? 'Buscar novamente' : 'Buscar duplicadas';
  $('addFolderBtn').disabled = !state.ready || busy;
  $('roots').querySelectorAll('input').forEach((input) => { input.disabled = busy; });
  const picked = selectedFiles();
  const bytes = picked.reduce((sum, file) => sum + file.bytes, 0);
  $('selectionTitle').textContent = picked.length ? `${count(picked.length, 'cópia selecionada', 'cópias selecionadas')} · ${size(bytes)}` : 'Nenhuma cópia selecionada';
  $('selectionDescription').textContent = state.dryRun ? 'Modo simulação: nenhum arquivo será movido.' : 'O espaço só fica disponível após esvaziar a Lixeira.';
  $('trashBtn').disabled = busy || !picked.length || !state.snapshot?.scanId || state.snapshot?.cancelled === true;
  $('trashLabel').textContent = state.busy === 'trash' ? 'Processando…' : state.dryRun ? 'Simular envio à Lixeira' : 'Mover para a Lixeira';
  $('clearSelectionBtn').hidden = !picked.length;
  $('clearSelectionBtn').disabled = busy;
  $('photoGrid').querySelectorAll('input').forEach((input) => { input.disabled = busy || state.snapshot?.cancelled === true; });
  $('photoGrid').querySelectorAll('.keep-copy').forEach((button) => { button.disabled = busy || state.snapshot?.cancelled === true; });
  $('openPhotosBtn').disabled = busy;
  $('modePhotos').disabled = busy;
  $('modeFiles').disabled = busy;
  $('simBadge').hidden = !state.dryRun;
}

function renderGroups() {
  const list = groups();
  releaseThumbnails($('groupList'));
  $('groupCount').textContent = nf.format(list.length);
  const extras = list.reduce((sum, group) => sum + Math.max(0, group.files.length - 1), 0);
  $('groupsSummary').textContent = list.length ? `${count(extras, 'cópia extra', 'cópias extras')} para revisar` : state.snapshot ? 'Busca concluída' : 'Sua busca aparecerá aqui';
  $('sidebarEmpty').hidden = list.length > 0;
  $('groupList').replaceChildren(...list.map((group, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'group-item'; button.setAttribute('aria-current', String(group.id === state.activeGroup)); button.dataset.groupId = group.id;
    const thumb = document.createElement('div'); thumb.className = 'group-thumb'; watchThumbnail(thumb, group.files[0]);
    const info = document.createElement('span'); info.className = 'group-info';
    const name = document.createElement('span'); name.className = 'group-name'; name.textContent = group.files[0]?.name || `Grupo ${index + 1}`; name.title = name.textContent;
    const meta = document.createElement('span'); meta.className = 'group-meta'; meta.textContent = `${count(group.files.length, 'cópia', 'cópias')} · `;
    const amount = document.createElement('b'); amount.textContent = size((group.files[0]?.bytes || group.bytes || 0) * Math.max(0, group.files.length - 1)); meta.append(amount);
    info.append(name, meta); button.append(thumb, info);
    if (group.files.some((file) => state.selected.has(file.id))) { const mark = document.createElement('span'); mark.className = 'group-selected'; mark.setAttribute('aria-label', 'Contém cópias selecionadas'); button.append(mark); }
    button.addEventListener('click', () => { state.activeGroup = group.id; renderGroups(); renderReview(); });
    return button;
  }));
}

function renderEmpty() {
  const completed = Boolean(state.snapshot);
  const movedAll = completed && state.result && !state.result.dryRun && (state.result.moved?.length || state.result.movedCount);
  const cancelled = state.snapshot?.cancelled;
  $('emptyKicker').textContent = cancelled ? 'VOCÊ CONTROLA A BUSCA' : movedAll ? 'REVISÃO CONCLUÍDA' : completed ? 'TUDO CONFERIDO' : 'SÓ AS CÓPIAS QUE VOCÊ ESCOLHER';
  $('emptyTitle').textContent = cancelled ? 'Busca cancelada.' : movedAll ? 'Suas cópias foram para a Lixeira.' : completed ? (isPhotoMode() ? 'Nenhuma foto duplicada encontrada.' : 'Nenhum arquivo duplicado encontrado.') : (isPhotoMode() ? 'Dê espaço às suas fotos.' : 'Seus arquivos, sem cópias extras.');
  $('emptyText').textContent = cancelled ? 'Você pode iniciar uma nova busca quando quiser. Nenhum arquivo foi movido.' : movedAll ? 'As cópias que você decidiu manter continuam nas suas pastas. Você pode fazer uma nova busca a qualquer momento.' : completed ? (isPhotoMode() ? 'Não encontramos fotos exatamente iguais nas pastas analisadas. Fotos parecidas ou editadas são preservadas.' : 'Não encontramos arquivos pessoais exatamente iguais nas pastas analisadas. Tipos não permitidos ficam fora da busca.') : (isPhotoMode() ? 'Busque cópias idênticas nas pastas selecionadas. Você revisa cada grupo antes de mover qualquer arquivo.' : 'Compare documentos, vídeos, áudios e compactados nas pastas escolhidas. Você decide qual cópia manter.');
  $('emptySteps').hidden = completed;
}

function renderReview() {
  const group = groupFor(state.activeGroup);
  releaseThumbnails($('photoGrid'));
  $('groupReview').hidden = !group;
  $('emptyState').hidden = Boolean(group);
  if (!group) { $('photoGrid').replaceChildren(); renderEmpty(); updateControls(); return; }
  const index = groups().findIndex((item) => item.id === group.id);
  $('reviewTitle').textContent = `Grupo ${index + 1} · ${count(group.files.length, 'cópia', 'cópias')}`;
  $('reviewCount').textContent = `${size(group.files[0]?.bytes || group.bytes || 0)} por ${itemWord()}`;
  $('reviewDescription').textContent = state.snapshot?.cancelled ? 'A busca foi cancelada. Faça uma nova busca antes de mover arquivos.' : 'Escolha uma cópia para manter ou marque individualmente as que deseja mover.';
  $('photoGrid').replaceChildren(...group.files.map((file) => {
    const card = document.createElement('article'); card.className = 'photo-card'; card.dataset.fileId = file.id;
    const preview = document.createElement('div'); preview.className = 'photo-preview'; watchThumbnail(preview, file, true);
    const tag = document.createElement('span'); tag.className = 'preview-tag'; preview.append(tag);
    const body = document.createElement('div'); body.className = 'photo-body';
    const name = document.createElement('h3'); name.textContent = file.name; name.title = file.name;
    const meta = document.createElement('p'); meta.className = 'file-meta';
    for (const content of [size(file.bytes), date(file.modifiedAt)]) { const item = document.createElement('span'); item.textContent = content; meta.append(item); }
    const path = document.createElement('p'); path.className = 'file-path'; path.textContent = displayPath(file.path); path.title = file.path;
    const reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'text-button finder-button'; reveal.append(icon('folder'), document.createTextNode('Mostrar no Finder'));
    reveal.addEventListener('click', async () => { try { const out = await window.photos.reveal(file.id, state.mode); if (out?.ok === false) error(out.error || 'Não foi possível mostrar este arquivo no Finder.'); } catch (e) { error(e.message || 'Não foi possível abrir o Finder.'); } });
    body.append(name, meta, path, reveal);
    const label = document.createElement('label'); label.className = 'select-copy';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.selected.has(file.id); input.setAttribute('aria-label', `Mover a cópia ${file.name} em ${file.path} para a Lixeira`);
    input.addEventListener('change', () => {
      if (input.checked) {
        const already = group.files.filter((item) => state.selected.has(item.id)).length;
        if (already >= group.files.length - 1) { input.checked = false; announce('Mantenha pelo menos uma cópia deste grupo.'); error('Pelo menos uma cópia de cada grupo precisa ser mantida. Desmarque outra cópia antes de selecionar esta.'); return; }
        state.selected.add(file.id);
      } else state.selected.delete(file.id);
      syncCardSelections(); renderGroups(); updateControls();
    });
    label.append(input, document.createTextNode('Mover esta cópia'));
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'keep-copy'; keep.textContent = 'Manter só esta';
    keep.setAttribute('aria-label', `Manter só a cópia ${file.name} em ${file.path}`);
    keep.title = 'Mantém esta cópia e seleciona as outras deste grupo para a Lixeira. Nada é movido antes da confirmação.';
    keep.addEventListener('click', () => {
      if (state.busy || state.snapshot?.cancelled) return;
      for (const other of group.files) {
        if (other.id === file.id) state.selected.delete(other.id);
        else state.selected.add(other.id);
      }
      syncCardSelections(); renderGroups(); updateControls();
      announce(`${file.name} será mantida. As demais cópias deste grupo estão selecionadas para a Lixeira e aguardam sua confirmação.`);
    });
    const actions = document.createElement('div'); actions.className = 'copy-actions'; actions.append(keep, label);
    card.append(preview, body, actions); return card;
  }));
  syncCardSelections(); updateControls();
}

function syncCardSelections() {
  for (const card of $('photoGrid').querySelectorAll('.photo-card')) {
    const selected = state.selected.has(card.dataset.fileId);
    card.classList.toggle('selected', selected);
    card.querySelector('input').checked = selected;
    const soleKeeper = !selected && groupFor(state.activeGroup)?.files.every(file => file.id === card.dataset.fileId || state.selected.has(file.id));
    card.querySelector('.keep-copy').setAttribute('aria-pressed', String(Boolean(soleKeeper)));
    card.querySelector('.preview-tag').textContent = selected ? 'Selecionada para a Lixeira' : 'Será mantida';
  }
}

function useSnapshot(snapshot, preferredGroup = state.activeGroup) {
  if (snapshot?.mode && snapshot.mode !== state.mode) throw new Error('O resultado pertence a outro tipo de busca. Faça uma nova análise.');
  state.snapshot = snapshot;
  state.selected.clear();
  state.activeGroup = groups().some((group) => group.id === preferredGroup) ? preferredGroup : groups()[0]?.id || null;
  renderGroups(); renderReview(); updateControls();
}

function renderProgress(progress = {}) {
  const labels = { walking: `Procurando ${itemsWord()} nas pastas…`, hashing: `Comparando o conteúdo dos ${itemsWord()}…`, comparing: 'Confirmando as cópias idênticas…' };
  if (isPhotoMode()) labels.hashing = 'Comparando o conteúdo das fotos…';
  $('progressTitle').textContent = labels[progress.phase] || `Analisando ${itemsWord()}…`;
  const found = isPhotoMode() ? progress.photos || 0 : progress.files ?? progress.candidates ?? progress.photos ?? 0;
  $('progressCount').textContent = progress.phase === 'walking' ? count(found, isPhotoMode() ? 'foto encontrada' : 'arquivo encontrado', isPhotoMode() ? 'fotos encontradas' : 'arquivos encontrados') : progress.total ? `${nf.format(progress.processed || 0)} de ${nf.format(progress.total)}` : count(found, isPhotoMode() ? 'foto analisada' : 'arquivo analisado', isPhotoMode() ? 'fotos analisadas' : 'arquivos analisados');
  const bar = $('scanProgress');
  if (progress.total > 0 && progress.phase !== 'walking') { bar.max = progress.total; bar.value = Math.min(progress.processed || 0, progress.total); } else bar.removeAttribute('value');
}

function taskComplete() {try {window.photos.taskComplete?.().catch(()=>{});}catch{}}

async function runScan() {
  if (state.busy || !state.selectedRoots.size) return;
  state.busy = 'scan'; state.result = null; state.selected.clear(); state.pending = null;
  error(''); $('resultNotice').hidden = true; $('progressPanel').hidden = false; $('cancelBtn').disabled = false; $('cancelBtn').textContent = 'Cancelar busca';
  $('scanProgress').removeAttribute('value'); renderProgress(); updateControls(); syncCardSelections();
  try {
    const snapshot = await window.photos.scan([...state.selectedRoots], state.mode);
    if (snapshot?.ok === false) throw new Error(snapshot.error || 'Não foi possível analisar os arquivos.');
    if (!snapshot || !Array.isArray(snapshot.groups)) throw new Error('Não foi possível concluir a busca. Tente novamente.');
    useSnapshot(snapshot);
    const scanErrors = snapshot.stats?.errors;
    if (Array.isArray(scanErrors) ? scanErrors.length : Number(scanErrors) > 0) error('Alguns arquivos ou pastas não puderam ser analisados. Os resultados incluem somente os itens verificados.');
    if (snapshot.cancelled) announce('Busca cancelada. Nenhum arquivo foi movido.');
    else {announce(`${count(groups().length, 'grupo encontrado', 'grupos encontrados')}. Nenhum arquivo foi movido.`);taskComplete();}
  } catch (e) { state.snapshot = null; state.activeGroup = null; state.selected.clear(); renderGroups(); renderReview(); error(e.message || 'Não foi possível concluir a busca.'); }
  finally { state.busy = null; $('progressPanel').hidden = true; updateControls(); }
}

async function addFolder() {
  if (state.busy) return;
  state.busy = 'folder'; updateControls();
  try {
    const out = await window.photos.addFolder(state.mode);
    if (out?.cancelled) return;
    if (!out?.ok) throw new Error(out?.error || 'Não foi possível adicionar esta pasta.');
    if (Array.isArray(out.roots)) state.roots = out.roots;
    if (out.root) { if (!state.roots.some((root) => root.id === out.root.id)) state.roots.push(out.root); state.selectedRoots.add(out.root.id); }
    renderRoots(); invalidateSearch();
  } catch (e) { error(e.message || 'Não foi possível adicionar esta pasta.'); }
  finally { state.busy = null; updateControls(); }
}

function confirmMove() {
  const chosen = selectedFiles();
  if (state.busy || !chosen.length || !state.snapshot?.scanId || state.snapshot.cancelled) return;
  state.pending = { mode: state.mode, scanId: state.snapshot.scanId, ids: chosen.map((file) => file.id), expectedDryRun: state.dryRun };
  const bytes = chosen.reduce((sum, file) => sum + file.bytes, 0);
  $('confirmTitle').textContent = state.dryRun ? 'Simular o envio destas cópias?' : 'Mover as cópias para a Lixeira?';
  $('confirmText').textContent = state.dryRun ? `A seleção tem ${count(chosen.length, 'arquivo', 'arquivos')} (${size(bytes)}). O modo simulação está ativo: nenhum arquivo será movido.` : `${count(chosen.length, 'arquivo será movido', 'arquivos serão movidos')} para a Lixeira (${size(bytes)}). Você poderá recuperá-los enquanto a Lixeira não for esvaziada.`;
  $('confirmMove').textContent = state.dryRun ? 'Simular envio' : `Mover ${count(chosen.length, 'arquivo', 'arquivos')}`;
  $('confirmDialog').showModal(); $('confirmCancel').focus();
}

function showResult(out) {
  const results = Array.isArray(out.results) ? out.results : [];
  const moved = Array.isArray(out.moved) ? out.moved : results.filter((item) => item.status === 'moved');
  const simulated = Array.isArray(out.simulated) ? out.simulated : results.filter((item) => item.status === 'simulated');
  const skipped = Array.isArray(out.skipped) ? out.skipped : results.filter((item) => item.status === 'skipped');
  out.moved = moved; out.simulated = simulated; out.skipped = skipped;
  state.result = out;
  const qty = out.dryRun ? simulated.length : moved.length;
  $('resultTitle').textContent = out.dryRun ? `${count(qty, 'cópia seria enviada', 'cópias seriam enviadas')} para a Lixeira` : qty ? `${count(qty, 'cópia movida', 'cópias movidas')} para a Lixeira` : 'Nenhum arquivo foi movido';
  $('resultText').textContent = out.dryRun ? 'Simulação concluída. Todos os arquivos continuam em suas pastas.' : skipped.length ? `${count(skipped.length, 'arquivo foi preservado', 'arquivos foram preservados')} por segurança ou por uma falha na operação. Faça uma nova busca antes de tentar novamente.` : 'As cópias mantidas continuam nas suas pastas. O espaço só será disponibilizado após esvaziar a Lixeira.';
  $('resultDetails').replaceChildren(...skipped.map((item) => { const row = document.createElement('li'); row.textContent = `${item.name || 'Arquivo'}: ${item.reason || 'Não foi possível mover esta cópia.'}`; return row; }));
  $('resultDetails').hidden = skipped.length === 0;
  $('resultNotice').classList.toggle('partial', skipped.length > 0);
  $('resultNotice').querySelector('[data-icon]').replaceChildren(icon(skipped.length ? 'warning' : 'check'));
  $('resultNotice').hidden = false;
  if (out.warning) error(out.warning);
  announce($('resultTitle').textContent);
}

async function moveConfirmed() {
  const consent = state.pending;
  state.pending = null; $('confirmDialog').close();
  if (state.busy || !consent || consent.mode !== state.mode || consent.scanId !== state.snapshot?.scanId) return;
  state.busy = 'trash'; updateControls();
  try {
    const out = await window.photos.trash(consent);
    if (out?.ok === false || !out) throw new Error(out?.error || 'Não foi possível mover as cópias. Faça uma nova busca.');
    showResult(out);
    if(out.moved.length||out.simulated.length)taskComplete();
    if (out.snapshot) useSnapshot(out.snapshot);
    else {
      const movedIds = new Set(out.moved.map((item) => item.id));
      const next = { ...state.snapshot, groups: groups().map((group) => ({ ...group, files: group.files.filter((file) => !movedIds.has(file.id)) })).filter((group) => group.files.length > 1) };
      useSnapshot(next);
    }
  } catch (e) { error(e.message || 'Não foi possível mover as cópias. Faça uma nova busca.'); state.selected.clear(); syncCardSelections(); }
  finally { state.busy = null; updateControls(); }
}

$('scanBtn').addEventListener('click', runScan);
$('addFolderBtn').addEventListener('click', addFolder);
$('cancelBtn').addEventListener('click', async () => { if (state.busy !== 'scan') return; $('cancelBtn').disabled = true; $('cancelBtn').textContent = 'Cancelando…'; try { await window.photos.cancel(state.mode); } catch (e) { error(e.message || 'Não foi possível cancelar a busca.'); $('cancelBtn').disabled = false; $('cancelBtn').textContent = 'Cancelar busca'; } });
$('trashBtn').addEventListener('click', confirmMove);
$('confirmMove').addEventListener('click', moveConfirmed);
$('confirmCancel').addEventListener('click', () => { state.pending = null; $('confirmDialog').close(); });
$('confirmDialog').addEventListener('cancel', () => { state.pending = null; });
$('clearSelectionBtn').addEventListener('click', () => { state.selected.clear(); syncCardSelections(); renderGroups(); updateControls(); announce('Seleção desmarcada.'); });
$('errorClose').addEventListener('click', () => error(''));
$('resultClose').addEventListener('click', () => { $('resultNotice').hidden = true; });
$('openPhotosBtn').addEventListener('click', async () => { try { const out = await window.photos.openPhotos(); if (out?.ok === false) error(out.error || 'Não foi possível abrir o app Fotos.'); } catch (e) { error(e.message || 'Não foi possível abrir o app Fotos.'); } });

function renderMode() {
  const photos = isPhotoMode();
  document.body.dataset.mode = state.mode;
  document.title = `${modeTitle()} — CalangoClean`;
  $('windowTitle').textContent = modeTitle();
  $('searchDescription').textContent = photos ? 'Encontre fotos idênticas e escolha quais cópias manter.' : 'Documentos, vídeos, áudios e compactados. Escolha quais cópias manter.';
  $('searchPanel').setAttribute('aria-labelledby', photos ? 'modePhotos' : 'modeFiles');
  $('groupsPanel').setAttribute('aria-label', photos ? 'Grupos de fotos duplicadas' : 'Grupos de arquivos duplicados');
  $('reviewPanel').setAttribute('aria-label', photos ? 'Revisar fotos' : 'Revisar arquivos');
  $('sidebarEmptyText').textContent = photos ? 'As cópias de uma mesma foto ficam juntas.' : 'As cópias de um mesmo arquivo ficam juntas.';
  $('sidebarEmpty').querySelector('[data-icon]').replaceChildren(icon(photos ? 'images' : 'document'));
  $('photoStack').hidden = !photos;
  $('fileStack').hidden = photos;
  $('photosHelp').hidden = !photos;
  $('fileTypesNote').hidden = photos;
  for (const [id, mode] of [['modePhotos', 'photos'], ['modeFiles', 'files']]) {
    const selected = state.mode === mode;
    $(id).setAttribute('aria-selected', String(selected));
    $(id).tabIndex = selected ? 0 : -1;
  }
}

async function loadMode(mode, initialLoad = false) {
  if (!['photos', 'files'].includes(mode) || (!initialLoad && (state.busy || (mode === state.mode && state.ready)))) return;
  if (state.ready) rootSelections.set(state.mode, new Set(state.selectedRoots));
  state.mode = mode; state.busy = 'mode'; state.ready = false;
  state.snapshot = null; state.activeGroup = null; state.selected.clear(); state.pending = null; state.result = null;
  state.roots = []; state.selectedRoots.clear();
  if ($('confirmDialog').open) $('confirmDialog').close();
  for (const queued of thumbnailQueue.splice(0)) { thumbnailRequests.delete(queued.key); queued.resolve(null); }
  error(''); $('resultNotice').hidden = true; $('progressPanel').hidden = true;
  renderMode(); renderRoots(); renderGroups(); renderReview(); updateControls();
  try {
    const initial = await window.photos.init(mode);
    applyAppearance(initial);
    if (initial.mode && initial.mode !== mode) throw new Error('Não foi possível abrir este tipo de busca. Tente novamente.');
    state.roots = initial.roots || []; state.dryRun = initial.dryRun !== false;
    const available = new Set(state.roots.map(root => root.id));
    const previous = rootSelections.get(mode) || (initial.snapshot?.scanId ? initial.snapshot.rootIds : null);
    state.selectedRoots = new Set(previous ? [...previous].filter(id => available.has(id)) : state.roots.filter(root => mode === 'photos' || root.id === 'downloads').map(root => root.id));
    state.ready = true;
    $('demoBadge').hidden = !initial.demo;
    if (initial.error) error(initial.error);
    renderRoots();
    const snapshotRoots = initial.snapshot?.rootIds;
    const sameScope = !Array.isArray(snapshotRoots) || (snapshotRoots.length === state.selectedRoots.size && snapshotRoots.every(id => state.selectedRoots.has(id)));
    if (sameScope && (initial.snapshot?.scanId || initial.snapshot?.groups?.length)) useSnapshot(initial.snapshot);
    announce(`${modeTitle()}. Escolha as pastas e inicie a busca quando quiser.`);
  } catch (e) { error(e.message || 'Não foi possível iniciar a busca de duplicados.'); }
  finally { state.busy = null; updateControls(); }
}

$('modePhotos').addEventListener('click', () => loadMode('photos'));
$('modeFiles').addEventListener('click', () => loadMode('files'));
for (const id of ['modePhotos', 'modeFiles']) {
  $(id).addEventListener('keydown', async event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || state.busy) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'photos' : event.key === 'End' ? 'files' : state.mode === 'photos' ? 'files' : 'photos';
    await loadMode(next); $(next === 'photos' ? 'modePhotos' : 'modeFiles').focus();
  });
}

async function init() {
  if (!window.photos) { error('Não foi possível conectar à busca de duplicados. Feche e abra esta janela novamente.'); return; }
  const unsubscribe = window.photos.onProgress(progress => {
    if (state.busy === 'scan' && (progress.mode || 'photos') === state.mode) renderProgress(progress);
  });
  const unsubscribeAppearance = window.photos.onAppearance?.(applyAppearance);
  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') unsubscribe();
    if (typeof unsubscribeAppearance === 'function') unsubscribeAppearance();
    thumbnailObserver.disconnect();
  });
  await loadMode('photos', true);
}
init();
