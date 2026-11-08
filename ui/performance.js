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
    const state = { active: false, loaded: false, busy: '', generation: 0, processes: [], services: [], confirmation: null, refreshPromise: null, actionPromise: null };
    let restoreFocus = null;
    let background = null;
    let backgroundWasInert = false;

    const panel = create('section', 'performance-tool performance-panel');
    panel.setAttribute('aria-labelledby', 'performanceTitle');
    const heading = create('div', 'performance-heading');
    const titleGroup = create('div');
    const title = create('h2', '', 'Desempenho');
    title.id = 'performanceTitle';
    titleGroup.append(title, create('p', '', 'CPU e memória dos processos.'));
    const refreshButton = button('performanceRefresh', 'Atualizar');
    refreshButton.setAttribute('aria-label', 'Atualizar processos e serviços');
    heading.append(titleGroup, refreshButton);

    const pressure = create('section', 'performance-pressure');
    pressure.id = 'performancePressure';
    pressure.dataset.level = 'unknown';
    pressure.setAttribute('aria-label', 'Pressão de memória do macOS');
    const pressureText = create('strong', '', 'Pressão de memória: —');
    const pressureDetail = create('p', '', 'Atualize para consultar o macOS.');
    pressureDetail.id = 'performancePressureDetail';
    pressure.append(pressureText, pressureDetail);
    const sampledAt = create('p', 'performance-note', 'Leitura somente ao abrir esta aba ou clicar em Atualizar.');
    sampledAt.id = 'performanceSampledAt';

    const filters = create('div', 'performance-filters');
    const searchLabel = create('label', '', 'Buscar processo');
    searchLabel.htmlFor = 'performanceSearch';
    const search = create('input');
    search.id = 'performanceSearch';
    search.type = 'search';
    search.placeholder = 'Nome ou PID';
    search.autocomplete = 'off';
    search.spellcheck = false;
    searchLabel.append(search);
    const sortLabel = create('label', '', 'Ordenar por');
    sortLabel.htmlFor = 'performanceSort';
    const sort = create('select');
    sort.id = 'performanceSort';
    for (const [value, text] of [['cpu', 'CPU'], ['memory', 'Memória'], ['name', 'Nome']]) {
      const option = create('option', '', text);
      option.value = value;
      sort.append(option);
    }
    sortLabel.append(sort);
    filters.append(searchLabel, sortLabel);

    const count = create('p', 'performance-note', 'A lista ainda não foi carregada.');
    count.id = 'performanceCount';
    const processList = create('ul', 'performance-list');
    processList.id = 'performanceProcesses';
    processList.setAttribute('aria-label', 'Processos por uso de CPU ou memória');
    const emptyProcesses = create('p', 'performance-empty', 'Clique em Atualizar para listar os processos.');
    const processFrame = create('div', 'performance-list-frame');
    const columns = create('div', 'performance-columns');
    columns.setAttribute('aria-hidden', 'true');
    columns.append(create('span', 'performance-column-name', 'App / processo'), create('span', '', 'CPU'), create('span', '', 'Memória'), create('span'));
    processFrame.append(columns, processList, emptyProcesses);
    const metricNote = create('p', 'performance-note', 'CPU pode passar de 100% em vários núcleos. Memória mostra o uso residente.');

    const serviceHeading = create('h3', 'performance-section-title', 'Serviços do usuário');
    const serviceNote = create('p', 'performance-note', 'LaunchAgents carregados da sua pasta pessoal. Descarregar não apaga o serviço; ele pode voltar no próximo login.');
    const serviceError = create('p', 'performance-error');
    serviceError.id = 'performanceServiceError';
    serviceError.setAttribute('role', 'status');
    serviceError.hidden = true;
    const serviceList = create('ul', 'performance-list performance-services');
    serviceList.id = 'performanceServices';
    serviceList.setAttribute('aria-label', 'LaunchAgents do usuário carregados');
    const emptyServices = create('p', 'performance-empty', 'Atualize para consultar os serviços.');
    const serviceFrame = create('div', 'performance-list-frame');
    serviceFrame.append(serviceList, emptyServices);
    const status = create('p', 'performance-status');
    status.id = 'performanceStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    panel.append(heading, pressure, sampledAt, filters, count, processFrame, metricNote, serviceHeading, serviceNote, serviceError, serviceFrame, status);
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
      refreshButton.disabled = busy;
      refreshButton.textContent = state.busy === 'list' ? 'Lendo…' : 'Atualizar';
      search.disabled = busy;
      sort.disabled = busy;
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
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      const available = state.processes.filter(item => item.canTerminate || item.canForce);
      const items = available.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(query) || String(item.pid).includes(query));
      const key = sort.value === 'memory' ? 'memoryBytes' : 'cpu';
      items.sort((a, b) => (sort.value === 'name' ? 0 : (b[key] ?? -1) - (a[key] ?? -1)) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true }) || a.pid - b.pid);
      processList.replaceChildren();
      for (const item of items) {
        const row = create('li', 'performance-process-row');
        row.dataset.processPid = String(item.pid);
        const content = create('div', 'performance-row-body');
        const name = create('strong', 'performance-row-name', item.name);
        name.dataset.tip = item.name;
        const meta = create('span', 'performance-row-meta', `PID ${item.pid} · Aberto há ${elapsed(item.elapsedSeconds)}`);
        meta.dataset.tip = meta.textContent;
        content.append(name, meta);
        const mark = processIcon();
        if (typeof item.icon === 'string' && item.icon.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.icon)) {
          const image = create('img'); image.src = item.icon; image.alt = ''; image.width = 24; image.height = 24;
          image.addEventListener('error', () => { mark.replaceWith(processIcon()); }, { once: true });
          mark.replaceChildren(image); mark.classList.add('has-icon');
        }
        const cpu = create('span', 'performance-metrics performance-cpu', finite(item.cpu) ? `${number.format(item.cpu)}%` : '—');
        const memory = create('span', 'performance-metrics performance-memory', format(item.memoryBytes));
        cpu.setAttribute('aria-label', `CPU: ${cpu.textContent}`);
        memory.setAttribute('aria-label', `Memória: ${memory.textContent}`);
        row.append(mark, content, cpu, memory);
        if (item.canTerminate || item.canForce) {
          const force = item.canForce === true;
          const action = button('', force ? 'Forçar…' : 'Encerrar…');
          action.dataset.action = force ? 'force' : 'terminate';
          action.setAttribute('aria-label', `${force ? 'Forçar encerramento de' : 'Encerrar'} ${item.name}, PID ${item.pid}`);
          if (force) action.classList.add('performance-danger');
          row.append(action);
        } else {
          const protectedMark = create('span', 'performance-protected', 'Protegido');
          protectedMark.dataset.tip = item.blockedReason || 'Este processo não pode ser encerrado pelo CalangoClean.';
          protectedMark.setAttribute('aria-label', protectedMark.dataset.tip);
          row.append(protectedMark);
        }
        processList.append(row);
      }
      emptyProcesses.hidden = items.length > 0;
      processList.hidden = !items.length;
      emptyProcesses.textContent = !state.loaded ? 'Clique em Atualizar para listar os processos.' : query ? 'Nenhum processo encontrado para esta busca.' : 'Nenhum processo disponível para encerrar nesta leitura.';
      count.textContent = state.loaded ? `${items.length} de ${available.length} processos disponíveis · ${{memory:'maior memória primeiro',cpu:'maior CPU primeiro',name:'ordem alfabética'}[sort.value] || 'maior CPU primeiro'}` : 'A lista ainda não foi carregada.';
      updateControls();
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
      emptyServices.textContent = state.loaded ? 'Nenhum serviço disponível para descarregar.' : 'Atualize para consultar os serviços.';
      updateControls();
    }

    function renderPressure(value, error) {
      const level = ['normal', 'warning', 'critical'].includes(value?.level) ? value.level : 'unknown';
      pressure.dataset.level = level;
      pressureText.textContent = `Pressão de memória: ${{ normal: 'Normal', warning: 'Atenção', critical: 'Crítica', unknown: 'Indisponível' }[level]}`;
      const free = finite(value?.freePercent) && value.freePercent <= 100 ? `Memória livre informada pelo macOS: ${number.format(value.freePercent)}%.` : '';
      pressureDetail.textContent = typeof error === 'string' && error ? error : free || (level === 'unknown' ? 'Não foi possível consultar a pressão de memória.' : 'Leitura do macOS nesta atualização.');
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
          const seenPids = new Set();
          state.processes = result.processes.filter(item => Number.isSafeInteger(item?.pid) && item.pid > 0 && !seenPids.has(item.pid) && seenPids.add(item.pid)).map(item => ({
            pid: item.pid, name: typeof item.name === 'string' && item.name ? item.name : `Processo ${item.pid}`,
            cpu: finite(item.cpu) ? item.cpu : null, memoryBytes: finite(item.memoryBytes) ? item.memoryBytes : null,
            elapsedSeconds: finite(item.elapsedSeconds) ? item.elapsedSeconds : null,
            icon: item.icon,
            canTerminate: item.canTerminate === true, canForce: item.canForce === true,
            blockedReason: typeof item.blockedReason === 'string' ? item.blockedReason : ''
          }));
          const seenIds = new Set();
          state.services = (Array.isArray(result.services) ? result.services : []).filter(item => typeof item?.id === 'string' && item.id && !seenIds.has(item.id) && seenIds.add(item.id)).map(item => ({
            id: item.id, label: typeof item.label === 'string' && item.label ? item.label : 'Serviço sem nome',
            pid: item.pid, canUnload: item.canUnload === true, blockedReason: typeof item.blockedReason === 'string' ? item.blockedReason : ''
          }));
          state.loaded = true;
          serviceError.textContent = typeof result.serviceError === 'string' ? result.serviceError : '';
          serviceError.hidden = !serviceError.textContent;
          renderPressure(result.memoryPressure, result.pressureError);
          const date = new Date(result.sampledAt);
          sampledAt.textContent = Number.isNaN(date.getTime()) ? 'Leitura sob demanda. Clique em Atualizar para consultar novamente.' : `Leitura às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Atualize para consultar novamente.`;
          setStatus('');
          if(manual) { try { onComplete(); } catch {} }
          return true;
        } catch (error) {
          if (generation !== state.generation || !state.active) return false;
          state.processes = [];
          state.services = [];
          state.loaded = false;
          serviceError.hidden = true;
          renderPressure(null, 'A leitura de desempenho não foi concluída.');
          sampledAt.textContent = 'Leitura indisponível. Clique em Atualizar para tentar novamente.';
          setStatus(error instanceof Error ? error.message : 'Não foi possível consultar o desempenho.', 'error');
          return false;
        } finally {
          if (generation === state.generation) {
            state.busy = '';
            state.refreshPromise = null;
            renderProcesses();
            renderServices();
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
        state.confirmation = { kind, id: item.id, pid: item.pid, token: result.token, force, dryRun: result.dryRun, name: kind === 'process' ? result.name || item.name : result.label || item.label };
        const confirmation = state.confirmation;
        dialogTitle.textContent = confirmation.dryRun ? 'Simular operação?' : kind === 'service' ? 'Descarregar serviço?' : force ? 'Forçar encerramento?' : 'Encerrar processo?';
        dialogName.textContent = kind === 'process' ? `${confirmation.name} · PID ${item.pid}` : confirmation.name;
        dialogDescription.textContent = confirmation.dryRun ? 'Modo simulação: nenhum processo será encerrado e nenhum serviço será descarregado.' : kind === 'service' ? 'O serviço será descarregado desta sessão. O arquivo do LaunchAgent será preservado e o serviço poderá voltar no próximo login.' : force ? 'O processo ainda está aberto após a tentativa de encerramento. Forçar o encerramento interrompe o processo imediatamente.' : 'Será solicitado o encerramento deste processo. Ele poderá finalizar suas tarefas antes de sair.';
        dialogWarning.textContent = kind === 'service' ? 'Descarregar pode interromper tarefas em andamento. Salve seu trabalho antes de continuar.' : 'Você pode perder trabalho não salvo. Salve seus documentos antes de continuar.';
        confirmButton.textContent = confirmation.dryRun ? 'Simular' : kind === 'service' ? 'Descarregar serviço' : force ? 'Forçar encerramento' : 'Encerrar processo';
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
      state.busy = '';
      state.refreshPromise = null;
      closeConfirmation({ force: true, focus: false });
      return wasPending;
    }

    refreshButton.addEventListener('click', () => { void refresh({ manual: true }); });
    search.addEventListener('input', renderProcesses);
    sort.addEventListener('change', renderProcesses);
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
    updateControls();

    return { refresh, deactivate, handleEscape, destroy() { deactivate(); document.removeEventListener('keydown', handleDialogKeys, true); layer.remove(); panel.remove(); } };
  }

  window.CalangoPerformance = { initialize };
})();
