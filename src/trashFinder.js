const { execFile } = require('node:child_process');

// Scripts fixos: nenhum caminho ou comando recebido do painel é executado.
const SCRIPTS = {
  list: `ObjC.import('Foundation');
    const finder = Application('com.apple.finder');
    const items = finder.trash.items();
    return items.map(item => ObjC.unwrap($.NSURL.URLWithString(item.url()).path));`,
  empty: `const finder = Application('com.apple.finder');
    finder.empty(finder.trash);
    return null;`,
};

function create({ exec = execFile } = {}) {
  async function invoke(action) {
    const script = `(function () {
      try { const value = (function () { ${SCRIPTS[action]} })();
        return JSON.stringify({ ok: true, value });
      } catch (e) {
        return JSON.stringify({ ok: false, code: e.errorNumber ?? e.number ?? null, message: String(e.message) });
      }
    })();`;
    const stdout = await new Promise((resolve, reject) => {
      exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script],
        { timeout: action === 'empty' ? 120000 : 15000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
          if (err) { reject(err); return; }
          resolve(out);
        });
    });
    let result;
    try { result = JSON.parse(stdout); } catch {
      throw Object.assign(new Error('Resposta inválida do Finder.'), { code: 'FINDER_RESPONSE' });
    }
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    if (action === 'list' && (!Array.isArray(result.value) || result.value.some(p => typeof p !== 'string' || !p.startsWith('/')))) {
      throw Object.assign(new Error('Lista inválida do Finder.'), { code: 'FINDER_RESPONSE' });
    }
    return result.value;
  }
  return { list: () => invoke('list'), empty: () => invoke('empty') };
}

module.exports = create();
module.exports.create = create;
