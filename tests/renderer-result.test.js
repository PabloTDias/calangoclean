const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

// O renderer inteiro é carregado, mas main() não roda: nenhuma API do Electron é chamada.
async function renderer(limpa = {}) {
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.textContent = '';
      this.hidden = false;
      this.dataset = {};
      this.classList = { toggle() {}, remove() {}, contains() { return false; } };
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    insertAdjacentHTML() {} // ícone SVG fixo
    setAttribute() {}
    scrollIntoView() {}
    focus() {}
    querySelector(tagName) { return this.selectors?.[tagName] || this.children.find((child) => child.tagName === tagName); }
    set innerHTML(value) {
      if (this.confirmText) { this.html = value; return; }
      assert.equal(value, '<h3></h3><ul></ul>', 'somente o esqueleto fixo usa HTML');
      this.children = [new Element('h3'), new Element('ul')];
    }
  }
  const result = new Element('div');
  const confirmText = new Element('p');
  confirmText.confirmText = true;
  const elements = { result, confirmText };
  const cards = {};
  const document = {
    body: new Element('body'),
    createElement: (tagName) => new Element(tagName),
    addEventListener() {},
    getElementById: (id) => elements[id] ||= new Element('div'),
    querySelector: (selector) => cards[selector.match(/data-id="([^"]+)"/)?.[1]],
  };
  const source = await fs.readFile(path.join(__dirname, '../ui/renderer.js'), 'utf8');
  const isolated = source.replace(/\nmain\(\);\s*$/, '\n');
  assert.notEqual(isolated, source, 'a inicialização deve ficar desativada no teste');
  const context = vm.createContext({ document, window: { ICONS: {}, limpa }, Element });
  vm.runInContext(isolated + '\nglobalThis.rendererTest = { state, actionableIds, renderResult, applyAnalysis, confirmClean };', context);
  const makeCard = (id) => {
    const card = cards[id] = new Element('li');
    card.selectors = { '.cat-size': new Element('div'), '.cat-desc': new Element('div'), input: new Element('input') };
    return card;
  };
  return { ...context.rendererTest, result, elements, makeCard };
}

test('resultado mostra motivo de falha parcial junto aos bytes, sempre como texto', async () => {
  const { state, renderResult, result } = await renderer();
  state.cats = [{ id: 'trashOld', label: 'Lixeira' }];
  const reason = '1 item mantido: <img src=x onerror=alert(1)>';
  renderResult({ dryRun: false, results: [{ id: 'trashOld', freedBytes: 1000, skipped: false, reason }] });
  const row = result.querySelector('ul').children[0];
  assert.equal(row.children[0].textContent, 'Lixeira');
  assert.equal(row.children[1].textContent, `1,0 KB · ${reason}`);
  assert.equal(row.children[1].children.length, 0);
  renderResult({ dryRun: false, results: [{ id: 'trashOld', freedBytes: 1000, skipped: false, status: 'partial', reason }] });
  assert.equal(result.querySelector('h3').className, 'incomplete');
  assert.match(result.querySelector('h3').textContent, /Limpeza incompleta/);
});

test('card mostra só o tamanho a excluir e distingue autorização do Finder de erro de medição', async () => {
  const { state, applyAnalysis, makeCard, elements } = await renderer();
  state.cats = [{ id: 'trashOld', label: 'Lixeira', level: 'atencao', hint: '', detail: 'Exclusão permanente.' }];
  state.selected = new Set(['trashOld']);
  const card = makeCard('trashOld');
  const analysis = { id: 'trashOld', found: true, bytes: 1000, settings: { days: 7, totalBytes: 2000, eligibleCount: 1 } };
  applyAnalysis(analysis);
  assert.equal(card.querySelector('.cat-size').textContent, '1,0 KB');
  assert.equal(card.querySelector('.cat-desc').textContent, '');
  assert.doesNotMatch(card.dataset.tip, /7 dias|A limpar/);
  applyAnalysis({ ...analysis, accessIssue: 'Sem autorização para controlar o Finder', settings: { permissionKind: 'automation' } });
  assert.equal(card.querySelector('.cat-size').textContent, '—');
  assert.equal(card.querySelector('.cat-desc').children[0].textContent, 'Sem permissão');
  assert.equal(elements.permBanner.dataset.permission, 'automation');
  assert.match(elements.permText.textContent, /controlar o Finder/);
  applyAnalysis({ ...analysis, settings: { measurementError: true, statusReason: 'item: Sem permissão para ler este item.' } });
  assert.equal(card.querySelector('.cat-size').textContent, '—');
  assert.equal(elements.cleanBtn.disabled, true);
  assert.equal(elements.totalSel.textContent, '0 B');
});

test('resultado preserva motivo da limpeza pulada e a apresentação da simulação', async () => {
  const { state, renderResult, result } = await renderer();
  state.cats = [{ id: 'trashOld', label: 'Lixeira' }];
  renderResult({ dryRun: false, results: [{ id: 'trashOld', freedBytes: 0, skipped: true, reason: 'Sem permissão' }] });
  let row = result.querySelector('ul').children[0];
  assert.equal(row.className, 'skipped');
  assert.equal(row.children[1].textContent, 'Sem permissão');
  renderResult({ dryRun: true, results: [{ id: 'trashOld', freedBytes: 1000, skipped: false, reason: 'simulação' }] });
  row = result.querySelector('ul').children[0];
  assert.equal(row.children[1].textContent, '1,0 KB');
});

test('erros técnicos de limpeza têm resumo simples e detalhes preservados como texto', async () => {
  const { state, renderResult, result, applyAnalysis, makeCard } = await renderer();
  state.cats=[{id:'caches',label:'Caches de apps',level:'seguro',hint:''}];state.selected=new Set(['caches']);
  const reason='com.microsoft.VSCode.ShipIt: Não foi possível apagar este item (ENOTEMPTY).';
  const card=makeCard('caches');
  applyAnalysis({id:'caches',found:true,bytes:1000,settings:{statusReason:reason}});
  assert.equal(card.querySelector('.cat-desc').children[0].textContent,'Alguns arquivos foram mantidos');
  assert.match(card.dataset.tip,/ENOTEMPTY/);
  renderResult({dryRun:false,results:[{id:'caches',freedBytes:1000,status:'partial',reason}]});
  const row=result.querySelector('ul').children[0];
  assert.equal(row.children[1].textContent,'1,0 KB · Alguns arquivos foram mantidos');
  assert.equal(row.children[2].children[1].textContent,reason);
});

test('Lixeira com itens elegíveis vazios pode limpar, respeitando seleção e permissão', async () => {
  const { state, actionableIds } = await renderer();
  state.selected = new Set(['trashOld', 'caches']);
  state.info = {
    trashOld: { found: true, bytes: 0, settings: { eligibleCount: 1 } },
    caches: { found: true, bytes: 0 },
  };
  assert.deepEqual(Array.from(actionableIds()), ['trashOld']);
  state.info.trashOld.settings.eligibleCount = 0;
  assert.equal(actionableIds().length, 0);
  state.info.trashOld.settings.eligibleCount = 1;
  state.info.trashOld.accessIssue = 'Sem permissão';
  assert.equal(actionableIds().length, 0);
  state.info.trashOld.accessIssue = null;
  state.info.trashOld.settings.measurementError = true;
  assert.equal(actionableIds().length, 0);
  state.info.trashOld.settings.measurementError = false;
  state.info.trashOld.found = false;
  assert.equal(actionableIds().length, 0);
  state.info.trashOld.found = true;
  state.selected.delete('trashOld');
  assert.equal(actionableIds().length, 0);
  state.info.caches.bytes = 1000;
  assert.deepEqual(Array.from(actionableIds()), ['caches']);
});

test('navegadores abertos contam no total e a confirmação avisa para salvar antes de fechar', async () => {
  const { state, makeCard, applyAnalysis, actionableIds, confirmClean, elements } = await renderer();
  state.dryRun = false;
  state.cats = [{ id: 'browser', label: 'Cache de navegadores', level: 'seguro', requiresBrowserQuit: true }];
  state.selected = new Set(['browser']);
  makeCard('browser');
  applyAnalysis({ id: 'browser', found: true, bytes: 5000, blockedReason: 'Firefox aberto', settings: { runningBrowsers: [{ id: 'firefox', name: 'Firefox' }] } });
  assert.deepEqual(Array.from(actionableIds()), ['browser']);
  assert.equal(state.total, 5000);
  assert.equal(elements.totalSel.textContent, '5,0 KB');
  confirmClean();
  assert.equal(elements.confirmBrowsers.hidden, false);
  assert.match(elements.confirmBrowsers.textContent, /Firefox/);
  assert.match(elements.confirmBrowsers.textContent, /Salve seu trabalho/);
  assert.equal(elements.confirmOk.textContent, 'Fechar e limpar');
  assert.equal(state.confirmedClean.closeBrowsers, true);
  assert.equal(state.confirmedClean.expectedDryRun, false);
});

test('simulação não pede nem autoriza fechar navegadores', async () => {
  const { state, confirmClean, elements } = await renderer();
  state.dryRun = true;
  state.cats = [{ id: 'browser', level: 'seguro', requiresBrowserQuit: true }];
  state.selected = new Set(['browser']);
  state.info.browser = { found: true, bytes: 5000 };
  state.total = 5000;
  confirmClean();
  assert.equal(elements.confirmBrowsers.hidden, true);
  assert.equal(elements.confirmOk.textContent, 'Simular');
  assert.equal(state.confirmedClean.closeBrowsers, false);
});
