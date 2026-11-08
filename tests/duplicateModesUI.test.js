const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

// O renderer real roda com DOM mínimo e APIs falsas. Nenhuma janela é aberta,
// nenhum arquivo pessoal é lido e nenhuma operação de Lixeira é disponibilizada.
async function fixture(responses = {}) {
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = {};
      this.handlers = {}; this.className = ''; this.textContent = ''; this.hidden = false;
      this.open = false;
      this.classList = {
        add: name => { this.className += ` ${name}`; },
        toggle: (name, enabled) => {
          const names = new Set(this.className.split(' ').filter(Boolean));
          if (enabled) names.add(name); else names.delete(name);
          this.className = [...names].join(' ');
        },
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(child => child instanceof Element ? [child, ...child.querySelectorAll('*')] : []);
      if (selector === '*') return descendants;
      return descendants.filter(child => selector === 'input' ? child.tagName === 'input'
        : selector === '[data-icon]' ? child.dataset.icon !== undefined
          : selector === '[data-thumbnail]' ? child.dataset.thumbnail !== undefined
            : selector.startsWith('.') && child.className.split(' ').includes(selector.slice(1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  for (const id of ['sidebarEmpty', 'resultNotice']) {
    const marker = new Element('span'); marker.dataset.icon = 'images'; element(id).append(marker);
  }
  const calls = [];
  const observed = [];
  const roots = {
    photos: [{ id: 'pictures', label: 'Imagens', path: '/fixture/Pictures' }, { id: 'downloads', label: 'Downloads', path: '/fixture/Downloads' }],
    files: [{ id: 'downloads', label: 'Downloads', path: '/fixture/Downloads' }, { id: 'documents', label: 'Documentos', path: '/fixture/Documents' }, { id: 'desktop', label: 'Mesa', path: '/fixture/Desktop' }],
  };
  const documentElement = { style: {}, dataset: {} };
  const context = vm.createContext({
    document: { documentElement, getElementById: element, createElement: tag => new Element(tag), createTextNode: text => text, querySelectorAll: () => [], body: new Element() },
    window: { addEventListener() {}, photos: {
      init: async mode => {
        calls.push(['init', mode]);
        return { mode, roots: roots[mode], dryRun: true,
          snapshot: { mode, scanId: null, rootIds: [], groups: [] }, ...responses[mode] };
      },
      thumbnail: async (...args) => { calls.push(['thumbnail', ...args]); return { error: 'sem prévia' }; },
    } },
    IntersectionObserver: class { observe(holder) { observed.push(holder); } unobserve() {} disconnect() {} },
  });
  const source = await fs.readFile(path.join(__dirname, '..', 'ui', 'photos.js'), 'utf8');
  const isolated = source.replace(/\ninit\(\);\s*$/, '\n');
  assert.notEqual(isolated, source, 'o teste deve impedir a inicialização automática');
  vm.runInContext(isolated + '\nglobalThis.testUI = { state, loadMode, watchThumbnail, applyAppearance };', context);
  function changeRoot(label, checked) {
    const checkbox = element('roots').querySelectorAll('input').find(input => input.attributes['aria-label'] === `Procurar em ${label}`);
    assert.ok(checkbox, `checkbox da pasta ${label}`);
    checkbox.checked = checked; checkbox.handlers.change();
  }
  return { ...context.testUI, documentElement, element, calls, observed, Element, changeRoot };
}

test('aparência inicial e mudanças ao vivo preservam seleção, pastas e confirmação', async () => {
  const ui = await fixture({ photos: { appearance: 'noturno', colorScheme: 'dark' } });
  await ui.loadMode('photos', true);
  assert.equal(ui.documentElement.style.colorScheme, 'dark');
  assert.equal(ui.documentElement.dataset.appearance, 'noturno');
  ui.state.selected.add('copia-revisada');
  ui.state.pending = { ids: ['copia-revisada'] };
  ui.element('confirmDialog').open = true;
  const roots = [...ui.state.selectedRoots];
  ui.applyAppearance({ appearance: 'normal', colorScheme: 'light' });
  assert.equal(ui.documentElement.style.colorScheme, 'light');
  assert.equal(ui.documentElement.dataset.appearance, 'normal');
  assert.deepEqual([...ui.state.selectedRoots], roots);
  assert.deepEqual([...ui.state.selected], ['copia-revisada']);
  assert.equal(ui.element('confirmDialog').open, true);
  assert.deepEqual(ui.state.pending.ids, ['copia-revisada']);
  ui.applyAppearance({ appearance: 'automatico', colorScheme: 'dark' });
  assert.equal(ui.documentElement.dataset.appearance, 'automatico');
  assert.equal(ui.documentElement.style.colorScheme, 'dark');
  ui.applyAppearance({ appearance: 'normal', colorScheme: 'invalid' });
  assert.equal(ui.documentElement.style.colorScheme, 'dark');
});

test('snapshot inicial vazio não desmarca Imagens e Downloads na aba Fotos', async () => {
  const ui = await fixture();
  await ui.loadMode('photos', true);
  assert.deepEqual([...ui.state.selectedRoots], ['pictures', 'downloads']);
  assert.equal(ui.element('scanBtn').disabled, false);
  assert.equal(ui.state.snapshot, null);
  assert.equal(ui.element('photosHelp').hidden, false);
});

test('snapshot inicial vazio deixa apenas Downloads selecionado na aba Arquivos', async () => {
  const ui = await fixture();
  await ui.loadMode('files', true);
  assert.deepEqual([...ui.state.selectedRoots], ['downloads']);
  assert.equal(ui.element('scanBtn').disabled, false);
  assert.equal(ui.state.snapshot, null);
  assert.equal(ui.element('photosHelp').hidden, true);
  assert.equal(ui.element('windowTitle').textContent, 'Arquivos duplicados');
});

test('trocar de aba apaga seleção e confirmação e restaura as pastas escolhidas', async () => {
  const ui = await fixture();
  await ui.loadMode('photos', true);
  ui.changeRoot('Downloads', false);
  ui.state.selected.add('selecao-antiga');
  ui.state.pending = { mode: 'photos', ids: ['selecao-antiga'] };
  ui.element('confirmDialog').open = true;
  await ui.loadMode('files');
  assert.equal(ui.state.selected.size, 0);
  assert.equal(ui.state.pending, null);
  assert.equal(ui.element('confirmDialog').open, false);
  ui.changeRoot('Documentos', true);
  await ui.loadMode('photos');
  assert.deepEqual([...ui.state.selectedRoots], ['pictures']);
  await ui.loadMode('files');
  assert.deepEqual([...ui.state.selectedRoots], ['downloads', 'documents']);
});

test('snapshot concluído restaura seu escopo mas não reaparece após alterar pastas', async () => {
  const ui = await fixture({ files: { snapshot: { mode: 'files', scanId: 'files-scan', rootIds: ['documents'], groups: [] } } });
  await ui.loadMode('files', true);
  assert.deepEqual([...ui.state.selectedRoots], ['documents']);
  assert.equal(ui.state.snapshot.scanId, 'files-scan');
  ui.changeRoot('Downloads', true);
  assert.equal(ui.state.snapshot, null);
  await ui.loadMode('photos');
  await ui.loadMode('files');
  assert.deepEqual([...ui.state.selectedRoots], ['documents', 'downloads']);
  assert.equal(ui.state.snapshot, null, 'o resultado antigo não pode representar outro conjunto de pastas');
});

test('documentos e mídia usam ícones sem pedir miniaturas ou observar conteúdo', async () => {
  const ui = await fixture();
  await ui.loadMode('files', true);
  for (const [kind, extension] of [['document', '.pdf'], ['video', '.mp4'], ['audio', '.mp3'], ['archive', '.zip']]) {
    const holder = new ui.Element();
    ui.watchThumbnail(holder, { id: kind, name: `example${extension}`, kind, extension }, true);
    assert.ok(holder.className.includes('file-preview'));
    assert.equal(holder.dataset.kind, kind);
    assert.equal(holder.dataset.thumbnail, undefined);
  }
  assert.equal(ui.observed.length, 0);
  assert.equal(ui.calls.filter(call => call[0] === 'thumbnail').length, 0);
  await ui.loadMode('photos');
  ui.watchThumbnail(new ui.Element(), { id: 'photo', name: 'photo.jpg', kind: 'photo' }, true);
  assert.equal(ui.observed.length, 1, 'miniaturas ficam disponíveis apenas para Fotos');
});
