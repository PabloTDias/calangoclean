// Preferência visual compartilhada entre o painel e a janela de duplicados.
// Não lê o disco nem altera o sistema por conta própria: o Electron só muda a aparência deste app.
const MODES = Object.freeze(['normal', 'noturno', 'automatico']);
const SOURCES = Object.freeze({ normal: 'light', noturno: 'dark', automatico: 'system' });
const isMode = (value) => typeof value === 'string' && MODES.includes(value);
const normalize = (value) => isMode(value) ? value : 'automatico';

function create({ nativeTheme, config, onChanged = () => {} }) {
  let mode = 'automatico';
  let lastPublished = '';
  // Aplicado antes da criação das janelas; instalações antigas deixam de ficar presas no escuro.
  nativeTheme.themeSource = SOURCES[mode];

  function getState() {
    return { appearance: mode, colorScheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
  }

  function publish() {
    const state = getState();
    const key = `${state.appearance}:${state.colorScheme}`;
    if (lastPublished !== key) {
      lastPublished = key;
      onChanged(state);
    }
    return state;
  }

  function apply(value) {
    mode = normalize(value);
    nativeTheme.themeSource = SOURCES[mode];
    return publish();
  }

  const updated = () => publish();
  nativeTheme.on('updated', updated);

  async function initialize() {
    const { cfg, error } = await config.loadSafe();
    const state = apply(cfg.appearance);
    return { ...state, ...(error ? { error } : {}) };
  }

  async function set(value) {
    if (!isMode(value)) return { ok: false, ...getState(), error: 'Modo de exibição inválido.' };
    try {
      // Só muda a interface depois da gravação: uma falha não deixa seleção e config divergentes.
      const cfg = await config.update((current) => { current.appearance = value; });
      return { ok: true, ...apply(cfg.appearance) };
    } catch (error) {
      return { ok: false, ...getState(), error: `Não foi possível salvar a aparência: ${error.message}` };
    }
  }

  function dispose() { nativeTheme.removeListener('updated', updated); }
  return { getState, initialize, set, dispose };
}

module.exports = { MODES, isMode, normalize, create };
