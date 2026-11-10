(() => {
  'use strict';

  function initialize({ container, api, notify = () => {}, onComplete = () => {}, formatBytes } = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('Informe o painel de desempenho.');

    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (id, text, primary = false) => {
      const element = create('button', `performance-button${primary ? ' performance-primary' : ''}`, text);
      element.type = 'button';
      if (id) element.id = id;
      return element;
    };
    const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    const format = value => finite(value) ? (typeof formatBytes === 'function' ? formatBytes(value) : `${number.format(value / 1e6)} MB`) : '—';
    const errorText = (result, fallback) => typeof result?.error === 'string' && result.error.trim() ? result.error : fallback;
    const safeNotify = text => { try { notify(text); } catch { /* A notification never repeats an action. */ } };
    const state = { active: false, loaded: false, busy: '', generation: 0, processes: [], services: [], confirmation: null, refreshPromise: null, actionPromise: null, sort: 'cpu', direction: 'desc', memoryTotalBytes: null, processError: '' };
    const processRows = new Map();
    let restoreFocus = null;
    let background = null;
    let backgroundWasInert = false;
    let metricsTimer = null;
    let metricsInFlight = null;
    let metricsEpoch = 0;
    let nativeVisible = true;

    const svgElement = (tag, attributes = {}) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      return element;
    };

    function createGauge(id, label, explanation) {
      const card = create('section', 'performance-gauge');
      card.id = id;
      card.setAttribute('aria-valuemin', '0');
      card.setAttribute('aria-valuemax', '100');
      card.title = explanation;
      const caption = create('h3', 'performance-gauge-label', label);
      const svg = svgElement('svg', { viewBox: '0 0 140 80', 'aria-hidden': 'true', focusable: 'false' });
      const point = (radius, angle) => {
        const radians = angle * Math.PI / 180;
        return `${(70 + radius * Math.cos(radians)).toFixed(3)} ${(64 - radius * Math.sin(radians)).toFixed(3)}`;
      };
      const segments = [];
      for (let index = 0; index < 10; index++) {
        const start = 180 - index * 18 - 1.5;
        const end = 180 - (index + 1) * 18 + 1.5;
        const segment = svgElement('path', {
          d: `M ${point(53, start)} A 53 53 0 0 1 ${point(53, end)} L ${point(43, end)} A 43 43 0 0 0 ${point(43, start)} Z`,
          class: 'performance-gauge-segment',
          'data-zone': index < 2 ? 'low' : index < 6 ? 'medium' : index < 8 ? 'high' : 'very-high'
        });
        segments.push(segment);
        svg.append(segment);
      }
      const needle = svgElement('g', { class: 'performance-gauge-needle', transform: 'rotate(0 70 64)' });
      needle.append(svgElement('path', { d: 'M 32 64 L 69 60.5 L 74 64 L 69 67.5 Z' }));
      svg.append(needle, svgElement('circle', { class: 'performance-gauge-pivot', cx: 70, cy: 64, r: 4 }));
      const value = create('strong', 'performance-gauge-value', '—');
      const detail = create('p', 'performance-gauge-detail', 'Aguardando leitura');
      card.append(caption, svg, value, detail);
      function update(percent, description = 'Leitura indisponível') {
        const known = finite(percent) && percent <= 100;
        card.dataset.state = known ? 'ready' : 'unknown';
        card.setAttribute('role', known ? 'meter' : 'img');
        card.setAttribute('aria-label', `${label}: ${known ? `${number.format(percent)}%. ${description}` : 'leitura indisponível'}`);
        if (known) {
          card.setAttribute('aria-valuenow', String(percent));
          card.setAttribute('aria-valuetext', `${number.format(percent)}%. ${description}`);
          needle.setAttribute('transform', `rotate(${percent * 1.8} 70 64)`);
        } else {
          card.removeAttribute('aria-valuenow');
          card.removeAttribute('aria-valuetext');
        }
        needle.setAttribute('visibility', known ? 'visible' : 'hidden');
        needle.toggleAttribute('hidden', !known);
        segments.forEach((segment, index) => { segment.dataset.filled = String(known && percent > index * 10); });
        value.textContent = known ? `${number.format(percent)}%` : '—';
        detail.textContent = known ? description : 'Leitura indisponível';
      }
      update(null);
      return { card, update };
    }

    function createChart(id, label) {
      const card = create('section', 'performance-chart');
      card.id = id;
      const heading = create('div', 'performance-chart-heading');
      const title = create('h3', '', label);
      const value = create('strong', '', '—');
      heading.append(title, value);
      const svg = svgElement('svg', { viewBox: '0 0 180 64', preserveAspectRatio: 'none', role: 'img', 'aria-label': `${label}: aguardando leitura` });
      for (const y of [2, 31, 60]) svg.append(svgElement('path', { d: `M 0 ${y} H 180`, class: 'performance-chart-grid' }));
      const area = svgElement('path', { class: 'performance-chart-area' });
      const line = svgElement('path', { class: 'performance-chart-line' });
      const dot = svgElement('circle', { class: 'performance-chart-dot', r: 2.4, visibility: 'hidden' });
      svg.append(area, line, dot);
      const footer = create('div', 'performance-chart-footer');
      footer.append(create('span', '', 'Último minuto'), create('span', '', 'Agora'));
      const detail = create('p', 'performance-chart-detail', 'Aguardando leitura');
      card.append(heading, svg, footer, detail);
      const history = [];
      function update(percent, description, sampledTime) {
        const known = finite(percent) && percent <= 100;
        const time = Number.isFinite(sampledTime) ? sampledTime : Date.now();
        if (!history.length || history.at(-1).time !== time) history.push({ time, value: known ? percent : null });
        while (history.length > 120 || (history.length > 1 && history[0].time < time - 60000)) history.shift();
        const points = history.map(sample => sample.value === null ? null : {
          x: 180 - Math.min(60000, Math.max(0, time - sample.time)) / 60000 * 180,
          y: 60 - sample.value / 100 * 58
        });
        const segments = [];
        for (const point of points) {
          if (!point) { if (segments.at(-1)?.length) segments.push([]); continue; }
          if (!segments.length) segments.push([]);
          segments.at(-1).push(point);
        }
        const path = segment => segment.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
        line.setAttribute('d', segments.filter(segment => segment.length).map(path).join(' '));
        area.setAttribute('d', segments.filter(segment => segment.length > 1).map(segment => `${path(segment)} L ${segment.at(-1).x.toFixed(2)} 62 L ${segment[0].x.toFixed(2)} 62 Z`).join(' '));
        const last = points.at(-1);
        dot.setAttribute('visibility', last ? 'visible' : 'hidden');
        if (last) { dot.setAttribute('cx', last.x); dot.setAttribute('cy', last.y); }
        value.textContent = known ? `${number.format(percent)}%` : '—';
        detail.textContent = description;
        card.dataset.samples = String(history.length);
        svg.setAttribute('aria-label', `${label}: ${known ? `${number.format(percent)}%` : 'leitura indisponível'}. Histórico do último minuto.`);
      }
      return { card, update };
    }

    const panel = create('section', 'performance-tool performance-panel');
    panel.setAttribute('aria-labelledby', 'performanceTitle');
    const heading = create('div', 'performance-heading');
    const titleGroup = create('div');
    const title = create('h2', '', 'Desempenho');
    title.id = 'performanceTitle';
    titleGroup.append(title, create('p', '', 'Uso do Mac e dos aplicativos em tempo real.'));
    heading.append(titleGroup);

    const gauges = create('div', 'performance-gauges');
    const cpuGauge = createGauge('performanceCpuGauge', 'CPU', 'Uso total da CPU em uma amostra curta, considerando todos os núcleos. A CPU de cada processo na lista usa a leitura do macOS e pode passar de 100%.');
    const memoryGauge = createGauge('performanceMemoryGauge', 'Memória', 'RAM ocupada: memória total menos memória livre, incluindo caches que o macOS pode liberar. A pressão de memória abaixo indica se o sistema precisa de mais RAM.');
    gauges.append(cpuGauge.card, memoryGauge.card);

    const pressure = create('section', 'performance-pressure');
    pressure.id = 'performancePressure';
    pressure.dataset.level = 'unknown';
    pressure.setAttribute('aria-label', 'Pressão de memória do macOS');
    const pressureText = create('strong', '', 'Pressão de memória: —');
    const pressureDetail = create('p', '', 'Consultando o macOS…');
    pressureDetail.id = 'performancePressureDetail';
    pressure.append(pressureText, pressureDetail);
    const charts = create('div', 'performance-charts');
    const cpuChart = createChart('performanceCpuChart', 'CPU');
    const memoryChart = createChart('performanceMemoryChart', 'Memória');
    memoryChart.card.append(pressure);
    charts.append(cpuChart.card, memoryChart.card);
    const sampledAt = create('p', 'performance-note performance-live-note', 'Atualização automática a cada 0,5 s.');
    sampledAt.id = 'performanceSampledAt';

    const filters = create('div', 'performance-filters');
    const searchLabel = create('label', '', 'Buscar app ou processo');
    searchLabel.htmlFor = 'performanceSearch';
    const search = create('input');
    search.id = 'performanceSearch';
    search.type = 'search';
    search.placeholder = 'Buscar nome ou PID';
    search.setAttribute('aria-label', 'Buscar app ou processo por nome ou PID');
    search.autocomplete = 'off';
    search.spellcheck = false;
    searchLabel.append(search);
    filters.append(searchLabel);

    const count = create('p', 'performance-note', 'A lista ainda não foi carregada.');
    count.id = 'performanceCount';
    const processList = create('ul', 'performance-list');
    processList.id = 'performanceProcesses';
    processList.setAttribute('aria-label', 'Aplicativos agrupados por uso de CPU ou memória');
    const emptyProcesses = create('p', 'performance-empty', 'Aguardando leitura automática…');
    const processFrame = create('div', 'performance-list-frame');
    processFrame.id = 'performanceProcessFrame';
    const columns = create('div', 'performance-columns');
    const sortButtons = new Map();
    for (const [key, label] of [['name', 'App / processo'], ['cpu', 'CPU'], ['memory', 'Memória']]) {
      const header = button(`performanceSort${key[0].toUpperCase()}${key.slice(1)}`, label);
      header.className = `performance-sort${key === 'name' ? ' performance-column-name' : ''}`;
      header.dataset.sort = key;
      header.addEventListener('click', () => {
        state.direction = state.sort === key ? (state.direction === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc';
        state.sort = key;
        renderProcesses();
      });
      sortButtons.set(key, { header, label });
      columns.append(header);
    }
    columns.append(create('span'));
    processFrame.append(columns, processList, emptyProcesses);
    const processError = create('p', 'performance-error');
    processError.id = 'performanceProcessError';
    processError.hidden = true;
    processError.setAttribute('role', 'status');
    const metricNote = create('p', 'performance-note', 'Memória: parcela da RAM total. CPU pode passar de 100% em vários núcleos.');

    const serviceHeading = create('h3', 'performance-section-title', 'Serviços do usuário');
    const serviceNote = create('p', 'performance-note', 'LaunchAgents carregados da sua pasta pessoal. Descarregar não apaga o serviço; ele pode voltar no próximo login.');
    const serviceError = create('p', 'performance-error');
    serviceError.id = 'performanceServiceError';
    serviceError.setAttribute('role', 'status');
    serviceError.hidden = true;
    const serviceList = create('ul', 'performance-list performance-services');
    serviceList.id = 'performanceServices';
    serviceList.setAttribute('aria-label', 'LaunchAgents do usuário carregados');
    const emptyServices = create('p', 'performance-empty', 'Consultando os serviços…');
    const serviceFrame = create('div', 'performance-list-frame');
    serviceFrame.append(serviceList, emptyServices);
    const status = create('p', 'performance-status');
    status.id = 'performanceStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    panel.append(heading, gauges, charts, sampledAt, filters, count, processError, processFrame, metricNote, serviceHeading, serviceNote, serviceError, serviceFrame, status);
    container.replaceChildren(panel);

    // The dialog is outside the scroll container and its inert application background.
    const layer = create('div', 'performance-tool performance-dialog-layer');
    layer.hidden = true;
    const dialog = create('section', 'performance-dialog');
    dialog.id = 'performanceConfirm';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'performanceConfirmTitle');
    dialog.setAttribute('aria-describedby', 'performanceConfirmDescription performanceConfirmWarning');
    const dialogTitle = create('h2');
    dialogTitle.id = 'performanceConfirmTitle';
    const dialogName = create('p', 'performance-confirm-name');
    dialogName.id = 'performanceConfirmName';
    const dialogDescription = create('p', 'performance-confirm-description');
    dialogDescription.id = 'performanceConfirmDescription';
    const dialogWarning = create('p', 'performance-confirm-warning');
    dialogWarning.id = 'performanceConfirmWarning';
    const dialogProgress = create('p', 'performance-note', 'Executando…');
    dialogProgress.setAttribute('role', 'status');
    dialogProgress.hidden = true;
    const dialogActions = create('div', 'performance-dialog-actions');
    const cancelButton = button('performanceCancel', 'Cancelar');
    const confirmButton = button('performanceConfirmOk', 'Encerrar processo', true);
    dialogActions.append(cancelButton, confirmButton);
    dialog.append(dialogTitle, dialogName, dialogDescription, dialogWarning, dialogProgress, dialogActions);
    layer.append(dialog);
    document.body.append(layer);

    function setStatus(text, kind = '') {
      status.textContent = String(text || '');
      status.hidden = !text;
      status.dataset.kind = kind;
    }

    function updateControls() {
      const busy = Boolean(state.busy);
      panel.setAttribute('aria-busy', String(busy));
      search.disabled = busy;
      for (const { header } of sortButtons.values()) header.disabled = busy;
      for (const action of panel.querySelectorAll('button[data-action]')) action.disabled = busy;
      const executing = state.busy === 'action';
      cancelButton.disabled = executing;
      confirmButton.disabled = busy || !state.confirmation;
      dialog.setAttribute('aria-busy', String(executing));
      dialogProgress.hidden = !executing;
    }

    function elapsed(value) {
      if (!finite(value)) return 'Tempo indisponível';
      const minutes = Math.floor(value / 60);
      if (minutes < 1) return `${Math.floor(value)} s`;
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours} h ${minutes % 60} min`;
      return `${Math.floor(hours / 24)} d ${hours % 24} h`;
    }

    function processIcon() {
      const mark = create('span', 'performance-process-icon');
      mark.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.5');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M7 3v3m5-3v3m5-3v3M7 18v3m5-3v3m5-3v3M3 7h3m-3 5h3m-3 5h3m12-10h3m-3 5h3m-3 5h3M6 6h12v12H6zM9 9h6v6H9z');
      svg.append(path);
      mark.append(svg);
      return mark;
    }

    function renderProcesses() {
      const focused = processList.contains(document.activeElement) ? document.activeElement : null;
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      const available = state.processes.filter(item => item.canTerminate || item.canForce);
      const items = available.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(query) || item.pids.some(pid => String(pid).includes(query)));
      const key = state.sort === 'memory' ? 'memoryBytes' : 'cpu';
      const compareNames = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true });
      items.sort((a, b) => {
        if (state.sort === 'name') return (state.direction === 'asc' ? 1 : -1) * compareNames(a, b) || a.pid - b.pid;
        if (a[key] === null || b[key] === null) return a[key] === b[key] ? compareNames(a, b) : a[key] === null ? 1 : -1;
        return (state.direction === 'asc' ? 1 : -1) * (a[key] - b[key]) || compareNames(a, b) || a.pid - b.pid;
      });
      for (const [key, { header, label }] of sortButtons) {
        const selected = state.sort === key;
        header.dataset.direction = selected ? state.direction : '';
        header.textContent = `${label}${selected ? state.direction === 'asc' ? ' ↑' : ' ↓' : ''}`;
        header.setAttribute('aria-label', `${label}${selected ? `, ordem ${state.direction === 'asc' ? 'crescente' : 'decrescente'}` : ''}. Clique para ordenar ${selected && state.direction === 'desc' || !selected && key === 'name' ? 'em ordem crescente' : 'em ordem decrescente'}.`);
        header.setAttribute('aria-pressed', String(selected));
      }
      const present = new Set();
      for (const [index, item] of items.entries()) {
        present.add(item.id);
        let refs = processRows.get(item.id);
        if (!refs) {
          const row = create('li', 'performance-process-row');
          const content = create('div', 'performance-row-body');
          const name = create('strong', 'performance-row-name');
          const meta = create('span', 'performance-row-meta');
          content.append(name, meta);
          const mark = processIcon();
          const cpu = create('span', 'performance-metrics performance-cpu');
          const memory = create('div', 'performance-metrics performance-memory');
          const memoryValue = create('span', 'performance-memory-value');
          const memoryUsage = create('span', 'performance-memory-usage');
          const memoryBar = create('span', 'performance-memory-bar');
          const memoryFill = create('span');
          memoryBar.append(memoryFill);
          const memoryPercent = create('span', 'performance-memory-percent');
          memoryUsage.append(memoryBar, memoryPercent);
          memory.append(memoryValue, memoryUsage);
          const action = button('', '×');
          action.classList.add('performance-close');
          row.append(mark, content, cpu, memory, action);
          refs = { row, name, meta, mark, cpu, memory, memoryValue, memoryPercent, memoryBar, memoryFill, action, icon: undefined };
          processRows.set(item.id, refs);
        }
        const { row, name, meta, mark, cpu, memory, memoryValue, memoryPercent, memoryBar, memoryFill, action } = refs;
        row.dataset.processPid = String(item.pid);
        row.dataset.processId = item.id;
        name.textContent = item.name;
        name.dataset.tip = item.name;
        meta.textContent = `${item.processCount > 1 ? `${item.processCount} processos` : `PID ${item.pid}`} · ${elapsed(item.elapsedSeconds)}`;
        meta.dataset.tip = `PIDs: ${item.pids.join(', ')} · Aberto há ${elapsed(item.elapsedSeconds)}`;
        if (refs.icon !== item.icon) {
          refs.icon = item.icon;
          mark.classList.remove('has-icon');
          mark.replaceChildren(...processIcon().childNodes);
          if (typeof item.icon === 'string' && item.icon.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.icon)) {
            const image = create('img'); image.src = item.icon; image.alt = ''; image.width = 24; image.height = 24;
            image.addEventListener('error', () => { mark.replaceChildren(...processIcon().childNodes); mark.classList.remove('has-icon'); }, { once: true });
            mark.replaceChildren(image); mark.classList.add('has-icon');
          }
        }
        cpu.textContent = finite(item.cpu) ? `${number.format(item.cpu)}%` : '—';
        memoryValue.textContent = format(item.memoryBytes);
        const percent = finite(item.memoryBytes) && finite(state.memoryTotalBytes) && state.memoryTotalBytes > 0 ? item.memoryBytes / state.memoryTotalBytes * 100 : null;
        const known = finite(percent);
        memoryPercent.textContent = known ? `${number.format(percent)}%` : '—';
        memoryFill.style.width = `${known ? Math.min(100, percent) : 0}%`;
        memoryBar.dataset.level = !known ? 'unknown' : percent >= 30 ? 'high' : percent >= 15 ? 'medium' : 'low';
        memoryBar.setAttribute('role', known ? 'meter' : 'img');
        memoryBar.setAttribute('aria-label', known ? `RAM total: ${number.format(percent)}%` : 'Parcela da RAM indisponível');
        if (known) {
          memoryBar.setAttribute('aria-valuemin', '0');
          memoryBar.setAttribute('aria-valuemax', '100');
          memoryBar.setAttribute('aria-valuenow', String(Math.min(100, percent)));
          memoryBar.setAttribute('aria-valuetext', `${format(item.memoryBytes)}, ${number.format(percent)}% da RAM total`);
        } else {
          for (const attribute of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) memoryBar.removeAttribute(attribute);
        }
        cpu.setAttribute('aria-label', `CPU: ${cpu.textContent}`);
        memory.setAttribute('aria-label', `Memória: ${format(item.memoryBytes)}${known ? `, ${number.format(percent)}% da RAM total` : ''}`);
        const force = item.canForce === true;
        action.textContent = '×';
        action.title = `${force ? 'Forçar encerramento de' : 'Encerrar'} ${item.name}`;
        action.dataset.action = force ? 'force' : 'terminate';
        action.classList.toggle('performance-danger', force);
        action.setAttribute('aria-label', `${force ? 'Forçar encerramento de' : 'Encerrar'} ${item.name}, ${item.processCount > 1 ? `${item.processCount} processos` : `PID ${item.pid}`}`);
        if (processList.children[index] !== row) {
          const before = processList.children[index] || null;
          if (row.parentNode === processList && typeof processList.moveBefore === 'function') processList.moveBefore(row, before);
          else processList.insertBefore(row, before);
        }
      }
      for (const [id, { row }] of processRows) if (!present.has(id)) { row.remove(); processRows.delete(id); }
      emptyProcesses.hidden = items.length > 0;
      processList.hidden = !items.length;
      emptyProcesses.textContent = !state.loaded ? 'Aguardando leitura automática…' : query ? 'Nenhum processo encontrado para esta busca.' : 'Nenhum processo disponível para encerrar nesta leitura.';
      count.textContent = state.loaded ? `${items.length} de ${available.length} apps e processos · ${{ memory: state.direction === 'desc' ? 'maior memória primeiro' : 'menor memória primeiro', cpu: state.direction === 'desc' ? 'maior CPU primeiro' : 'menor CPU primeiro', name: state.direction === 'asc' ? 'A–Z' : 'Z–A' }[state.sort]}` : 'A lista ainda não foi carregada.';
      processError.textContent = state.processError;
      processError.hidden = !state.processError;
      processFrame.dataset.stale = String(Boolean(state.processError));
      updateControls();
      if (focused?.isConnected && !focused.disabled && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }

    function acceptProcesses(processes) {
      const seen = new Set();
      state.processes = processes.filter(item => Number.isSafeInteger(item?.pid) && item.pid > 0 && !seen.has(item.pid) && seen.add(item.pid)).map(item => {
        const pids = [...new Set((Array.isArray(item.pids) ? item.pids : [item.pid]).filter(pid => Number.isSafeInteger(pid) && pid > 0))];
        if (!pids.includes(item.pid)) pids.unshift(item.pid);
        return {
          id: typeof item.id === 'string' && item.id ? item.id : String(item.pid),
          pid: item.pid, pids, processCount: pids.length, isAppGroup: item.isAppGroup === true,
          name: typeof item.name === 'string' && item.name ? item.name : `Processo ${item.pid}`,
          cpu: finite(item.cpu) ? item.cpu : null, memoryBytes: finite(item.memoryBytes) ? item.memoryBytes : null,
          elapsedSeconds: finite(item.elapsedSeconds) ? item.elapsedSeconds : null, icon: item.icon,
          canTerminate: item.canTerminate === true, canForce: item.canForce === true,
          blockedReason: typeof item.blockedReason === 'string' ? item.blockedReason : ''
        };
      });
    }

    function renderServices() {
      serviceList.replaceChildren();
      const available = state.services.filter(item => item.canUnload);
      for (const item of available) {
        const row = create('li', 'performance-service-row');
        row.dataset.serviceId = item.id;
        const content = create('div', 'performance-row-body');
        const label = create('strong', 'performance-row-name', item.label);
        label.dataset.tip = item.label;
        content.append(label, create('span', 'performance-row-meta', Number.isInteger(item.pid) && item.pid > 0 ? `Em execução · PID ${item.pid}` : 'Carregado · aguardando execução'));
        row.append(content);
        if (item.canUnload) {
          const action = button('', 'Descarregar…');
          action.dataset.action = 'unload';
          action.setAttribute('aria-label', `Descarregar serviço ${item.label}`);
          row.append(action);
        } else {
          const protectedMark = create('span', 'performance-protected', 'Protegido');
          protectedMark.dataset.tip = item.blockedReason || 'Este serviço está protegido.';
          protectedMark.setAttribute('aria-label', protectedMark.dataset.tip);
          row.append(protectedMark);
        }
        serviceList.append(row);
      }
      serviceList.hidden = !available.length;
      emptyServices.hidden = available.length > 0 || !serviceError.hidden;
      emptyServices.textContent = state.loaded ? 'Nenhum serviço disponível para descarregar.' : 'Consultando os serviços…';
      updateControls();
    }

    function renderPressure(value, error) {
      const level = ['normal', 'warning', 'critical'].includes(value?.level) ? value.level : 'unknown';
      pressure.dataset.level = level;
      pressureText.textContent = `Pressão de memória: ${{ normal: 'Normal', warning: 'Atenção', critical: 'Crítica', unknown: 'Indisponível' }[level]}`;
      const free = finite(value?.freePercent) && value.freePercent <= 100 ? `Memória livre informada pelo macOS: ${number.format(value.freePercent)}%.` : '';
      pressureDetail.textContent = typeof error === 'string' && error ? error : free || (level === 'unknown' ? 'Não foi possível consultar a pressão de memória.' : 'Leitura do macOS nesta atualização.');
      pressure.title = `${pressureText.textContent}. ${pressureDetail.textContent} Pressão consultada a cada 5 s.`;
    }

    function renderGauges(metrics, sampledTime = Date.now()) {
      cpuGauge.update(metrics?.cpuPercent, 'Todos os núcleos');
      const used = metrics?.memoryUsedBytes;
      const total = metrics?.memoryTotalBytes;
      const valid = finite(used) && finite(total) && total > 0 && used <= total;
      state.memoryTotalBytes = valid ? total : null;
      memoryGauge.update(valid ? used / total * 100 : null, valid ? `${format(used)} de ${format(total)}` : '');
      cpuChart.update(metrics?.cpuPercent, 'Uso total de todos os núcleos', sampledTime);
      memoryChart.update(valid ? used / total * 100 : null, valid ? `${format(used)} de ${format(total)} em uso` : 'RAM em uso indisponível', sampledTime);
    }

    const canMonitor = () => state.active && nativeVisible && !document.hidden && !container.hidden;

    function stopMonitoring() {
      if (metricsTimer !== null) clearInterval(metricsTimer);
      metricsTimer = null;
      ++metricsEpoch;
    }

    function syncMonitoring() {
      if (!canMonitor()) { stopMonitoring(); return; }
      if (metricsTimer === null && typeof api?.getPerformanceMetrics === 'function') {
        metricsTimer = setInterval(() => { void refreshMetrics(); }, 500);
      }
    }

    function setVisible(visible) {
      nativeVisible = visible === true;
      syncMonitoring();
    }

    function renderMetrics(result) {
      const date = new Date(result?.sampledAt);
      renderGauges(result?.systemMetrics, date.getTime());
      renderPressure(result?.memoryPressure, result?.pressureError);
      sampledAt.textContent = Number.isNaN(date.getTime()) ? 'Atualização automática a cada 0,5 s.' : `Ao vivo · 0,5 s · ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    async function refreshMetrics() {
      if (canMonitor() && !state.loaded && !state.busy && !state.confirmation && !state.actionPromise) { await refresh(); return; }
      if (!canMonitor() || state.busy || state.confirmation || state.actionPromise || metricsInFlight) return;
      const generation = state.generation;
      const epoch = metricsEpoch;
      const current = () => generation === state.generation && epoch === metricsEpoch && canMonitor() && !state.busy && !state.confirmation;
      const pending = (async () => {
        await Promise.resolve();
        try {
          const result = await api.getPerformanceMetrics();
          if (!current()) return;
          if (!result || result.ok === false) throw new Error('Leitura indisponível.');
          renderMetrics(result);
          if (Array.isArray(result.processes)) { acceptProcesses(result.processes); state.loaded = true; }
          state.processError = typeof result.processError === 'string' && result.processError ? `Lista desatualizada: ${result.processError}` : '';
          renderProcesses();
        } catch {
          if (!current()) return;
          renderGauges(null);
          renderPressure(null, 'A leitura automática não foi concluída.');
          sampledAt.textContent = 'Leitura indisponível. Nova tentativa automática a cada 0,5 s.';
          state.processError = 'Lista desatualizada. A leitura automática não foi concluída; tentando novamente a cada 0,5 s.';
          renderProcesses();
        } finally {
          if (metricsInFlight === pending) metricsInFlight = null;
        }
      })();
      metricsInFlight = pending;
      return pending;
    }

    function closeConfirmation({ force = false, focus = true } = {}) {
      if (state.busy === 'action' && !force) return true;
      const wasOpen = !layer.hidden;
      layer.hidden = true;
      dialog.hidden = true;
      state.confirmation = null;
      if (background) background.inert = backgroundWasInert;
      background = null;
      updateControls();
      if (focus && restoreFocus?.isConnected && !restoreFocus.disabled && state.active) restoreFocus.focus();
      restoreFocus = null;
      return wasOpen;
    }

    async function refresh({ manual = false } = {}) {
      state.active = true;
      if (state.actionPromise) return false;
      if (state.refreshPromise) return state.refreshPromise;
      if (state.busy) return false;
      stopMonitoring();
      closeConfirmation();
      const generation = ++state.generation;
      state.busy = 'list';
      setStatus('Consultando processos e serviços…');
      updateControls();
      const pending = (async () => {
        await Promise.resolve();
        try {
          if (typeof api?.getPerformance !== 'function') throw new Error('A leitura de desempenho está indisponível.');
          const result = await api.getPerformance();
          if (generation !== state.generation || !state.active) return false;
          if (result?.ok === false || !Array.isArray(result?.processes)) throw new Error(errorText(result, 'Não foi possível consultar os processos.'));
          acceptProcesses(result.processes);
          state.processError = '';
          const seenIds = new Set();
          state.services = (Array.isArray(result.services) ? result.services : []).filter(item => typeof item?.id === 'string' && item.id && !seenIds.has(item.id) && seenIds.add(item.id)).map(item => ({
            id: item.id, label: typeof item.label === 'string' && item.label ? item.label : 'Serviço sem nome',
            pid: item.pid, canUnload: item.canUnload === true, blockedReason: typeof item.blockedReason === 'string' ? item.blockedReason : ''
          }));
          state.loaded = true;
          serviceError.textContent = typeof result.serviceError === 'string' ? result.serviceError : '';
          serviceError.hidden = !serviceError.textContent;
          renderMetrics(result);
          setStatus('');
          if(manual) { try { onComplete(); } catch {} }
          return true;
        } catch (error) {
          if (generation !== state.generation || !state.active) return false;
          state.processes = [];
          state.processError = '';
          state.services = [];
          state.loaded = false;
          serviceError.hidden = true;
          renderGauges(null);
          renderPressure(null, 'A leitura de desempenho não foi concluída.');
          sampledAt.textContent = 'Leitura indisponível. Uma nova tentativa será feita automaticamente.';
          setStatus(error instanceof Error ? error.message : 'Não foi possível consultar o desempenho.', 'error');
          return false;
        } finally {
          if (generation === state.generation) {
            state.busy = '';
            state.refreshPromise = null;
            renderProcesses();
            renderServices();
            syncMonitoring();
          }
        }
      })();
      state.refreshPromise = pending;
      return pending;
    }

    async function prepare(kind, item, force = false) {
      if (!state.active || state.busy || state.confirmation || state.actionPromise) return;
      const generation = ++state.generation;
      state.busy = 'prepare';
      setStatus('Verificando antes de confirmar…');
      updateControls();
      try {
        const result = kind === 'process' ? await api.prepareProcess(item.pid, { force }) : await api.prepareService(item.id);
        if (generation !== state.generation || !state.active || container.hidden) return;
        if (!result?.ok) throw new Error(errorText(result, 'Não foi possível preparar esta operação.'));
        if (typeof result.token !== 'string' || !result.token || typeof result.dryRun !== 'boolean' || (kind === 'process' ? result.pid !== item.pid || result.force !== force : result.id !== item.id)) {
          throw new Error('A confirmação é inválida. Atualize a lista e tente novamente.');
        }
        const processCount = Array.isArray(result.pids) ? result.pids.length : item.processCount || 1;
        state.confirmation = { kind, id: item.id, pid: item.pid, token: result.token, force, dryRun: result.dryRun, processCount, name: kind === 'process' ? result.name || item.name : result.label || item.label };
        const confirmation = state.confirmation;
        const grouped = kind === 'process' && processCount > 1;
        dialogTitle.textContent = confirmation.dryRun ? 'Simular operação?' : kind === 'service' ? 'Descarregar serviço?' : force ? 'Forçar encerramento?' : grouped ? 'Encerrar aplicativo?' : 'Encerrar processo?';
        dialogName.textContent = kind === 'process' ? `${confirmation.name} · ${grouped ? `${processCount} processos` : `PID ${item.pid}`}` : confirmation.name;
        dialogDescription.textContent = confirmation.dryRun ? `Modo simulação: nenhum processo será encerrado e nenhum serviço será descarregado.${grouped ? ` Esta operação inclui ${processCount} processos do aplicativo.` : ''}` : kind === 'service' ? 'O serviço será descarregado desta sessão. O arquivo do LaunchAgent será preservado e o serviço poderá voltar no próximo login.' : force ? `Forçar o encerramento interrompe imediatamente ${grouped ? `os ${processCount} processos revisados deste aplicativo` : 'o processo ainda aberto após a tentativa de encerramento'}.` : grouped ? `Será solicitado o encerramento dos ${processCount} processos deste aplicativo, incluindo os auxiliares revisados.` : 'Será solicitado o encerramento deste processo. Ele poderá finalizar suas tarefas antes de sair.';
        dialogWarning.textContent = kind === 'service' ? 'Descarregar pode interromper tarefas em andamento. Salve seu trabalho antes de continuar.' : 'Você pode perder trabalho não salvo. Salve seus documentos antes de continuar.';
        confirmButton.textContent = confirmation.dryRun ? 'Simular' : kind === 'service' ? 'Descarregar serviço' : force ? 'Forçar encerramento' : grouped ? 'Encerrar aplicativo' : 'Encerrar processo';
        confirmButton.classList.toggle('performance-danger', force && !confirmation.dryRun);
        restoreFocus = document.activeElement;
        background = container.closest('.app');
        if (background) { backgroundWasInert = background.inert; background.inert = true; }
        layer.hidden = false;
        dialog.hidden = false;
        setStatus('');
      } catch (error) {
        if (generation === state.generation && state.active) setStatus(error instanceof Error ? error.message : 'Não foi possível preparar esta operação.', 'error');
      } finally {
        if (generation === state.generation) {
          state.busy = '';
          updateControls();
          if (state.confirmation) cancelButton.focus();
        }
      }
    }

    async function execute() {
      const confirmation = state.confirmation;
      if (!confirmation || state.busy || !state.active || state.actionPromise) return;
      const generation = state.generation;
      state.busy = 'action';
      updateControls();
      const pending = (async () => {
        await Promise.resolve();
        try {
          const payload = { token: confirmation.token, expectedDryRun: confirmation.dryRun };
          const result = confirmation.kind === 'process' ? await api.terminateProcess({ ...payload, pid: confirmation.pid, force: confirmation.force }) : await api.unloadService({ ...payload, id: confirmation.id });
          if (generation !== state.generation || !state.active) return;
          if (!result?.ok) throw new Error(errorText(result, 'Não foi possível concluir a operação. Atualize a lista antes de tentar novamente.'));
          if (result.simulated !== confirmation.dryRun) throw new Error('Não foi possível confirmar o modo da operação. Atualize a lista para verificar o resultado.');
          let text;
          if (result.simulated) text = 'Simulação concluída. Nenhum processo foi encerrado e nenhum serviço foi descarregado.';
          else if (confirmation.kind === 'service') {
            state.services = state.services.filter(item => item.id !== confirmation.id);
            text = `${confirmation.name} foi descarregado desta sessão. O arquivo do serviço foi preservado.`;
          } else {
            const item = state.processes.find(process => process.pid === confirmation.pid);
            if (result.exited === true) {
              state.processes = state.processes.filter(process => process.pid !== confirmation.pid);
              text = `${confirmation.name} foi encerrado.`;
            } else {
              if (item) { item.canForce = !confirmation.force && result.canForce === true; item.canTerminate = !item.canForce && !confirmation.force; }
              text = result.canForce === true && !confirmation.force ? `${confirmation.name} continua aberto. Se necessário, use Forçar encerramento após salvar seu trabalho.` : 'A solicitação foi enviada. Atualize a lista para verificar se o processo foi encerrado.';
            }
          }
          const warning = typeof result.warning === 'string' ? result.warning.trim() : '';
          if (warning) text += ` ${warning}`;
          setStatus(text, warning || (result.exited === false && !result.simulated) ? 'warning' : 'success');
          safeNotify(text);
          try { onComplete(); } catch {}
        } catch (error) {
          if (generation === state.generation && state.active) {
            const text = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
            setStatus(text, 'error');
            safeNotify(text);
          }
        } finally {
          state.actionPromise = null;
          if (generation === state.generation) {
            state.busy = '';
            closeConfirmation();
            renderProcesses();
            renderServices();
          }
        }
      })();
      state.actionPromise = pending;
      return pending;
    }

    function cancelPending() {
      if (state.busy !== 'prepare') return false;
      ++state.generation;
      state.busy = '';
      state.confirmation = null;
      setStatus('Revisão cancelada. Nenhuma ação foi executada.');
      updateControls();
      return true;
    }

    function handleEscape() {
      if (state.busy === 'action') return true;
      if (cancelPending()) return true;
      if (!layer.hidden) { ++state.generation; closeConfirmation(); return true; }
      return false;
    }

    function deactivate() {
      const wasPending = state.busy === 'prepare' || !layer.hidden;
      ++state.generation;
      state.active = false;
      stopMonitoring();
      state.busy = '';
      state.refreshPromise = null;
      closeConfirmation({ force: true, focus: false });
      return wasPending;
    }

    search.addEventListener('input', renderProcesses);
    processList.addEventListener('click', event => {
      const action = event.target.closest('button[data-action]');
      if (!action || !processList.contains(action)) return;
      const item = state.processes.find(process => process.pid === Number(action.closest('[data-process-pid]')?.dataset.processPid));
      const force = action.dataset.action === 'force';
      if (item && (force ? item.canForce : item.canTerminate)) void prepare('process', item, force);
    });
    serviceList.addEventListener('click', event => {
      const action = event.target.closest('button[data-action="unload"]');
      if (!action || !serviceList.contains(action)) return;
      const item = state.services.find(service => service.id === action.closest('[data-service-id]')?.dataset.serviceId);
      if (item?.canUnload) void prepare('service', item);
    });
    cancelButton.addEventListener('click', () => { ++state.generation; closeConfirmation(); });
    confirmButton.addEventListener('click', () => { void execute(); });
    const handleDialogKeys = event => {
      if (!state.active) return;
      if (event.key === 'Escape' && (state.busy === 'prepare' || !layer.hidden)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handleEscape();
      } else if (!layer.hidden && event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled)')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) event.preventDefault();
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleDialogKeys, true);
    document.addEventListener('visibilitychange', syncMonitoring);
    updateControls();

    return { refresh, deactivate, setVisible, handleEscape, destroy() { deactivate(); document.removeEventListener('keydown', handleDialogKeys, true); document.removeEventListener('visibilitychange', syncMonitoring); layer.remove(); panel.remove(); } };
  }

  window.CalangoPerformance = { initialize };
})();
