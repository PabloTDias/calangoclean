(() => {
  'use strict';

  function initialize({ container, api, notify = () => {}, onMutation = () => {}, onComplete = () => {}, formatBytes } = {}) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('Informe o painel de aplicativos.');
    }

    const format = typeof formatBytes === 'function' ? formatBytes : bytes => {
      const value = Number(bytes);
      if (!Number.isFinite(value) || value < 0) return 'Tamanho indisponível';
      if (value < 1024) return `${value} B`;
      const unit = value >= 1024 ** 3 ? 'GB' : value >= 1024 ** 2 ? 'MB' : 'KB';
      const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
      return `${(value / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`;
    };
    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const button = (id, text, primary = false) => {
      const element = create('button', `applications-button${primary ? ' applications-primary' : ''}`, text);
      element.type = 'button';
      element.id = id;
      return element;
    };
    const message = (result, fallback) => typeof result?.error === 'string' && result.error.trim() ? result.error : fallback;
    const safeNotify = text => { try { notify(text); } catch { /* A notification must not repeat an operation. */ } };
    const state = { items: [], selected: null, busy: '', confirmation: null, destroyed: false, loaded: false, status: '', statusKind: '', refreshPromise: null, prepareGeneration: 0 };
    let restoreFocus = null;
    let background = null;
    let backgroundWasInert = false;

    const panel = create('section', 'applications-tool applications-panel');
    panel.setAttribute('aria-labelledby', 'appsTitle');
    const heading = create('div', 'applications-heading');
    const titleGroup = create('div');
    const title = create('h2', '', 'Aplicativos instalados');
    title.id = 'appsTitle';
    const intro = create('p', '', 'Veja seus apps e quando foram usados pela última vez.');
    titleGroup.append(title, intro);
    const refreshButton = button('appsRefresh', 'Atualizar');
    refreshButton.setAttribute('aria-label', 'Atualizar lista de aplicativos');
    heading.append(titleGroup, refreshButton);

    const searchGroup = create('div', 'applications-search');
    const searchLabel = create('label', '', 'Buscar aplicativo');
    searchLabel.htmlFor = 'appsSearch';
    const search = create('input');
    search.id = 'appsSearch';
    search.type = 'search';
    search.placeholder = 'Nome do aplicativo';
    search.autocomplete = 'off';
    search.spellcheck = false;
    searchGroup.append(searchLabel, search);
    const count = create('p', 'applications-count', 'A lista ainda não foi carregada.');
    count.id = 'appsCount';
    const list = create('ul', 'applications-list');
    list.id = 'appsList';
    list.setAttribute('aria-label', 'Aplicativos instalados');
    const empty = create('p', 'applications-empty', 'Clique em Atualizar para listar os aplicativos.');
    const listFrame = create('div', 'applications-list-frame');
    listFrame.append(list, empty);

    const detail = create('section', 'applications-detail');
    detail.id = 'appsDetail';
    detail.hidden = true;
    detail.setAttribute('aria-labelledby', 'appsSelectedName');
    const selectedName = create('h3');
    selectedName.id = 'appsSelectedName';
    const selectedMeta = create('p', 'applications-meta');
    const selectedReason = create('p', 'applications-reason');
    const detailActions = create('div', 'applications-actions');
    const revealButton = button('appsReveal', 'Mostrar no Finder');
    const prepareButton = button('appsPrepare', 'Desinstalar…', true);
    detailActions.append(revealButton, prepareButton);
    detail.append(selectedName, selectedMeta, selectedReason, detailActions);
    const note = create('p', 'applications-note', 'Documentos e preferências são preservados.');
    const status = create('p', 'applications-status');
    status.id = 'appsStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    panel.append(heading, searchGroup, count, detail, listFrame, note, status);
    container.replaceChildren(panel);

    // This portal stays outside the scrolling panel and its inert background.
    const layer = create('div', 'applications-tool applications-dialog-layer');
    layer.hidden = true;
    const dialog = create('section', 'applications-dialog');
    dialog.id = 'appsConfirm';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'appsConfirmTitle');
    dialog.setAttribute('aria-describedby', 'appsConfirmDescription appsConfirmNote');
    const dialogTitle = create('h2', '', 'Desinstalar aplicativo?');
    dialogTitle.id = 'appsConfirmTitle';
    const dialogApp = create('p', 'applications-confirm-app');
    const dialogDescription = create('p', 'applications-confirm-description');
    dialogDescription.id = 'appsConfirmDescription';
    const dialogNote = create('p', 'applications-confirm-note', 'Somente o aplicativo (.app) será movido para a Lixeira. Seus documentos e preferências serão preservados. A Lixeira não será esvaziada.');
    dialogNote.id = 'appsConfirmNote';
    const dialogWarning = create('p', 'applications-confirm-warning');
    const dialogProgress = create('p', 'applications-confirm-progress');
    dialogProgress.id = 'appsConfirmProgress';
    dialogProgress.setAttribute('role', 'status');
    dialogProgress.hidden = true;
    const dialogActions = create('div', 'applications-dialog-actions');
    const cancelButton = button('appsCancel', 'Cancelar');
    const confirmButton = button('appsConfirmAction', 'Mover para a Lixeira', true);
    dialogActions.append(cancelButton, confirmButton);
    dialog.append(dialogTitle, dialogApp, dialogDescription, dialogNote, dialogWarning, dialogProgress, dialogActions);
    layer.append(dialog);
    document.body.append(layer);

    function setStatus(text, kind = '') {
      state.status = String(text || '');
      state.statusKind = kind;
      status.textContent = state.status;
      status.hidden = !state.status;
      status.dataset.kind = kind;
    }

    function selectedItem() {
      return state.items.find(item => item.id === state.selected) || null;
    }

    function metadata(item) {
      const parts = [];
      if (item.version) parts.push(`Versão ${item.version}`);
      parts.push(item.bytes === null ? 'Tamanho ao revisar' : format(item.bytes));
      return parts.join(' · ');
    }

    function lastUsage(item) {
      if (item.running) return 'Em uso agora';
      const time = typeof item.lastUsedAt === 'string' ? Date.parse(item.lastUsedAt) : NaN;
      if (!Number.isFinite(time) || time > Date.now() + 60000) return 'Último uso não informado';
      const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
      return days === 0 ? 'Usado há menos de 1 dia' : `Sem uso há ${days.toLocaleString('pt-BR')} ${days === 1 ? 'dia' : 'dias'}`;
    }

    function allowed(item) {
      return item?.canUninstall === true && !item.running && !item.protected;
    }

    function updateControls() {
      const busy = Boolean(state.busy);
      panel.setAttribute('aria-busy', String(busy));
      refreshButton.disabled = busy;
      refreshButton.textContent = state.busy === 'list' ? 'Buscando…' : 'Atualizar';
      search.disabled = busy;
      const item = selectedItem();
      revealButton.disabled = busy || !item || typeof api?.revealApplication !== 'function';
      prepareButton.disabled = busy || !allowed(item);
      prepareButton.textContent = state.busy === 'prepare' ? 'Verificando…' : 'Desinstalar…';
      for (const row of list.querySelectorAll('button')) row.disabled = busy;
      const removing = state.busy === 'uninstall';
      cancelButton.disabled = removing;
      confirmButton.disabled = removing || !state.confirmation;
      dialog.setAttribute('aria-busy', String(removing));
      dialogProgress.hidden = !removing;
      if (removing) dialogProgress.textContent = state.confirmation?.dryRun ? 'Simulando desinstalação…' : 'Movendo aplicativo para a Lixeira…';
    }

    function renderDetail() {
      const item = selectedItem();
      detail.hidden = !item;
      if (item) {
        selectedName.textContent = item.name;
        selectedMeta.textContent = metadata(item);
        selectedReason.textContent = allowed(item) ? 'Revise antes de desinstalar.' : item.reason || (item.running ? 'Feche o aplicativo antes de desinstalar.' : 'Este aplicativo está protegido.');
        selectedReason.dataset.blocked = String(!allowed(item));
      }
      updateControls();
    }

    function filteredItems() {
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      return state.items.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(query))
        .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base',numeric:true}));
    }

    function renderList() {
      const items = filteredItems();
      list.replaceChildren();
      for (const item of items) {
        const li = create('li');
        const row = create('button', 'applications-row');
        row.type = 'button';
        row.dataset.appId = item.id;
        row.setAttribute('aria-pressed', String(state.selected === item.id));
        row.tabIndex = state.selected === item.id || (!state.selected && items[0] === item) ? 0 : -1;
        const mark = create('span', 'applications-app-mark', item.name.slice(0, 1).toLocaleUpperCase('pt-BR') || 'A');
        mark.setAttribute('aria-hidden', 'true');
        if (typeof item.icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.icon) && item.icon.length <= 262144) {
          const image = create('img'); image.src = item.icon; image.alt = ''; image.width = 26; image.height = 26;
          image.addEventListener('error', () => { mark.textContent = item.name.slice(0, 1).toLocaleUpperCase('pt-BR') || 'A'; mark.classList.remove('has-icon'); }, { once: true });
          mark.replaceChildren(image); mark.classList.add('has-icon');
        }
        const body = create('span', 'applications-row-body');
        const name = create('span', 'applications-row-name', item.name);
        const meta = create('span', 'applications-row-meta', metadata(item));
        const usage = create('span', 'applications-row-usage', lastUsage(item));
        usage.dataset.tip = item.lastUsedAt ? `Última abertura registrada pelo macOS: ${new Date(item.lastUsedAt).toLocaleString('pt-BR')}.` : 'O macOS não forneceu uma data de último uso para este app.';
        body.append(name, meta, usage);
        const badgeText = item.running ? 'Em uso' : !allowed(item) ? 'Protegido' : '';
        row.setAttribute('aria-label', [item.name, metadata(item), lastUsage(item), badgeText].filter(Boolean).join(', '));
        row.append(mark, body);
        if (badgeText) row.append(create('span', 'applications-badge', badgeText));
        li.append(row);
        list.append(li);
      }
      list.hidden = !items.length;
      empty.hidden = Boolean(items.length);
      if (!state.loaded) empty.textContent = 'Clique em Atualizar para listar os aplicativos.';
      else if (search.value.trim()) empty.textContent = 'Nenhum aplicativo encontrado para esta busca.';
      else empty.textContent = 'Nenhum aplicativo disponível nestas pastas.';
      const total = state.items.length;
      count.textContent = state.loaded ? (search.value.trim() ? `${items.length} de ${total} aplicativos` : `${total} ${total === 1 ? 'aplicativo encontrado' : 'aplicativos encontrados'}`) + ' · Nome (A–Z)' : 'A lista ainda não foi carregada.';
      renderDetail();
    }

    function select(id) {
      if (state.busy || !state.items.some(item => item.id === id)) return;
      state.selected = id;
      for (const row of list.querySelectorAll('button[data-app-id]')) {
        const selected = row.dataset.appId === id;
        row.setAttribute('aria-pressed', String(selected));
        row.tabIndex = selected ? 0 : -1;
      }
      renderDetail();
      detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function closeConfirmation() {
      if (layer.hidden) return false;
      if (state.busy === 'uninstall') return true;
      layer.hidden = true;
      dialog.hidden = true;
      state.confirmation = null;
      if (background) background.inert = backgroundWasInert;
      background = null;
      updateControls();
      if (restoreFocus?.isConnected && !restoreFocus.disabled) restoreFocus.focus();
      restoreFocus = null;
      return true;
    }

    async function refresh({ preserveStatus = false, manual = false } = {}) {
      if (state.destroyed) return false;
      if (state.refreshPromise) return state.refreshPromise;
      if (state.busy) return false;
      closeConfirmation();
      state.busy = 'list';
      if (!preserveStatus) setStatus('Buscando aplicativos…');
      updateControls();
      state.refreshPromise = (async () => {
        // Defer even a synchronous API failure until refreshPromise is assigned.
        await Promise.resolve();
        try {
          if (typeof api?.getApplications !== 'function') throw new Error('A lista de aplicativos está indisponível.');
          const result = await api.getApplications();
          if (state.destroyed) return false;
          if (!result?.ok) throw new Error(message(result, 'Não foi possível listar os aplicativos.'));
          const items = Array.isArray(result.items) ? result.items : Array.isArray(result.apps) ? result.apps : [];
          const seen = new Set();
          state.items = items.filter(item => typeof item?.id === 'string' && item.id && !seen.has(item.id) && seen.add(item.id)).map(item => ({
            id: item.id,
            name: typeof item.name === 'string' && item.name ? item.name : 'Aplicativo sem nome',
            version: typeof item.version === 'string' ? item.version : '',
            icon: item.icon,
            lastUsedAt: typeof item.lastUsedAt === 'string' && Number.isFinite(Date.parse(item.lastUsedAt)) ? item.lastUsedAt : null,
            bytes: Number.isFinite(item.bytes ?? item.size) && (item.bytes ?? item.size) >= 0 ? item.bytes ?? item.size : null,
            canUninstall: item.canUninstall === true,
            reason: typeof item.reason === 'string' ? item.reason : '',
            running: Boolean(item.running),
            protected: Boolean(item.protected)
          }));
          state.loaded = true;
          if (!selectedItem()) state.selected = null;
          if (!preserveStatus) {
            const warnings = Array.isArray(result.errors) ? result.errors.length : 0;
            setStatus(warnings ? `${warnings} ${warnings === 1 ? 'aplicativo não pôde ser lido' : 'aplicativos não puderam ser lidos'}.` : '', warnings ? 'warning' : '');
          }
          if(manual) { try { onComplete(); } catch {} }
          return true;
        } catch (error) {
          if (state.destroyed) return false;
          state.items = [];
          state.selected = null;
          state.loaded = false;
          const errorText = error instanceof Error ? error.message : 'Não foi possível listar os aplicativos.';
          setStatus(preserveStatus && state.status ? `${state.status} A lista não pôde ser atualizada.` : errorText, 'error');
          return false;
        } finally {
          state.busy = '';
          state.refreshPromise = null;
          if (!state.destroyed) renderList();
        }
      })();
      return state.refreshPromise;
    }

    async function prepare() {
      const item = selectedItem();
      if (state.busy || state.confirmation || !allowed(item)) return;
      const generation = ++state.prepareGeneration;
      state.busy = 'prepare';
      setStatus('Verificando o aplicativo…');
      updateControls();
      try {
        if (typeof api?.prepareUninstall !== 'function') throw new Error('A desinstalação está indisponível.');
        const result = await api.prepareUninstall(item.id);
        if (state.destroyed) return;
        if (generation !== state.prepareGeneration || container.hidden) {
          setStatus('A revisão foi descartada. Revise o aplicativo novamente para continuar.');
          return;
        }
        if (!result?.ok) throw new Error(message(result, 'Não foi possível preparar a desinstalação.'));
        const approved = result.app || result;
        if (typeof result.token !== 'string' || !result.token || (approved.id && approved.id !== item.id) || typeof result.dryRun !== 'boolean') {
          throw new Error('A confirmação expirou. Atualize a lista e tente novamente.');
        }
        const confirmation = {
          id: item.id,
          token: result.token,
          dryRun: result.dryRun,
          name: typeof approved.name === 'string' && approved.name ? approved.name : item.name,
          version: typeof approved.version === 'string' ? approved.version : item.version,
          bytes: Number.isFinite(approved.bytes ?? approved.size) ? approved.bytes ?? approved.size : item.bytes
        };
        state.confirmation = confirmation;
        dialogTitle.textContent = confirmation.dryRun ? 'Simular desinstalação?' : 'Desinstalar aplicativo?';
        dialogApp.textContent = confirmation.name;
        dialogDescription.textContent = `${metadata(confirmation)}. ${confirmation.dryRun ? 'O modo de simulação está ativo. Nenhum arquivo será movido.' : 'Você poderá recuperar o aplicativo pela Lixeira.'}`;
        dialogWarning.textContent = typeof result.warning === 'string' ? result.warning : '';
        dialogWarning.hidden = !dialogWarning.textContent;
        confirmButton.textContent = confirmation.dryRun ? 'Simular desinstalação' : 'Mover para a Lixeira';
        restoreFocus = document.activeElement;
        background = container.closest('.app');
        if (background) {
          backgroundWasInert = background.inert;
          background.inert = true;
        }
        layer.hidden = false;
        dialog.hidden = false;
        setStatus('');
      } catch (error) {
        if (!state.destroyed && generation === state.prepareGeneration && !container.hidden) {
          setStatus(error instanceof Error ? error.message : 'Não foi possível preparar a desinstalação.', 'error');
        }
      } finally {
        state.busy = '';
        if (!state.destroyed) {
          updateControls();
          if (state.confirmation) cancelButton.focus();
        }
      }
    }

    async function uninstall() {
      const confirmation = state.confirmation;
      if (state.busy || !confirmation) return;
      state.busy = 'uninstall';
      updateControls();
      let changed = false;
      let completed = false;
      try {
        if (typeof api?.uninstallApp !== 'function') throw new Error('A desinstalação está indisponível.');
        const result = await api.uninstallApp({ id: confirmation.id, token: confirmation.token, expectedDryRun: confirmation.dryRun });
        if (state.destroyed) return;
        if (!result?.ok) throw new Error(message(result, 'Não foi possível desinstalar o aplicativo.'));
        if (result.dryRun !== confirmation.dryRun || (!result.dryRun && result.movedToTrash !== true)) {
          throw new Error('Não foi possível confirmar a desinstalação. Atualize a lista para verificar o aplicativo.');
        }
        changed = !result.dryRun;
        const text = result.dryRun ? `Simulação concluída. ${confirmation.name} continua instalado.` : `${confirmation.name} foi movido para a Lixeira. O espaço será liberado quando ela for esvaziada.`;
        setStatus(text, 'success');
        safeNotify(text);
        completed = true;
      } catch (error) {
        if (!state.destroyed) {
          const text = error instanceof Error ? error.message : 'Não foi possível desinstalar o aplicativo.';
          setStatus(text, 'error');
          safeNotify(text);
        }
      } finally {
        state.busy = '';
        closeConfirmation();
        if (!state.destroyed) {
          await refresh({ preserveStatus: true });
          if (changed) {
            try { await onMutation(); } catch { /* The completed move must not be presented as a failed uninstall. */ }
          }
          if(completed) { try { onComplete(); } catch {} }
        }
      }
    }

    async function reveal() {
      const item = selectedItem();
      if (state.busy || !item || typeof api?.revealApplication !== 'function') return;
      state.busy = 'reveal';
      updateControls();
      try {
        const result = await api.revealApplication(item.id);
        if (result?.ok === false) throw new Error(message(result, 'Não foi possível mostrar o aplicativo no Finder.'));
      } catch (error) {
        if (!state.destroyed) setStatus(error instanceof Error ? error.message : 'Não foi possível abrir o Finder.', 'error');
      } finally {
        state.busy = '';
        if (!state.destroyed) updateControls();
      }
    }

    const handleRefresh = () => { void refresh({ manual: true }); };
    const handleSearch = () => { state.selected = null; renderList(); };
    const handleSelect = event => {
      const row = event.target.closest('button[data-app-id]');
      if (row && list.contains(row)) select(row.dataset.appId);
    };
    const handleListKeys = event => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (state.busy || !keys.includes(event.key)) return;
      const rows = [...list.querySelectorAll('button[data-app-id]')];
      if (!rows.length) return;
      const current = rows.indexOf(document.activeElement);
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = rows.length - 1;
      else next = Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault();
      select(rows[next].dataset.appId);
      rows[next].focus();
    };
    const handlePrepare = () => { void prepare(); };
    const handleReveal = () => { void reveal(); };
    const handleCancel = () => { closeConfirmation(); };
    const handleConfirm = () => { void uninstall(); };
    const handleDialogKeys = event => {
      if (layer.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeConfirmation();
      } else if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled)')];
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    refreshButton.addEventListener('click', handleRefresh);
    search.addEventListener('input', handleSearch);
    list.addEventListener('click', handleSelect);
    list.addEventListener('keydown', handleListKeys);
    prepareButton.addEventListener('click', handlePrepare);
    revealButton.addEventListener('click', handleReveal);
    cancelButton.addEventListener('click', handleCancel);
    confirmButton.addEventListener('click', handleConfirm);
    document.addEventListener('keydown', handleDialogKeys, true);
    updateControls();

    function deactivate() {
      ++state.prepareGeneration;
      const preparing = state.busy === 'prepare';
      if (preparing) setStatus('Revisão descartada. Aguarde para tentar novamente.');
      return closeConfirmation() || preparing;
    }

    return {
      refresh,
      cancelConfirmation: deactivate,
      deactivate,
      destroy() {
        if (state.busy === 'uninstall') return false;
        closeConfirmation();
        state.destroyed = true;
        document.removeEventListener('keydown', handleDialogKeys, true);
        layer.remove();
        panel.remove();
        return true;
      }
    };
  }

  window.CalangoApplications = { initialize };
})();
