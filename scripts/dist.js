// `npm run dist`: gera o .dmg universal deixando em dist/ SOMENTE o .dmg da versão nova.
//  1. antes: apaga todo o conteúdo de dist/ (dmgs antigos, mac-universal, blockmap etc.);
//  2. roda o electron-builder;
//  3. depois: remove tudo que não for .dmg (a pasta mac-universal descompactada, .blockmap, builder-debug.yml...).
// Em falha, também remove os intermediários. Só mexe dentro de dist/.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function build({ root = path.join(__dirname, '..'), run = spawnSync } = {}) {
  const ROOT = fs.realpathSync(root);
  const DIST = path.join(ROOT, 'dist');
  function clean(keep) {
    const stat = fs.lstatSync(DIST, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('dist/ precisa ser uma pasta real do projeto.');
    for (const name of fs.readdirSync(DIST)) {
      const target = path.resolve(DIST, name);
      if (!target.startsWith(DIST + path.sep)) throw new Error(`Fora de dist/: ${target}`);
      if (keep && keep(name)) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão de build inválida.');
  const name = `CalangoClean-${version}-universal.dmg`;
  const dmg = path.join(DIST, name);
  let verified = false;
  clean();
  try {
    const r = run(path.join(ROOT, 'node_modules', '.bin', 'electron-builder'), ['--mac', '--universal'], { cwd: ROOT, stdio: 'inherit' });
    if (r.error || r.status !== 0) throw new Error(`Falha ao gerar o instalador: ${r.error?.message || r.signal || r.status}`);
    const stat = fs.lstatSync(dmg);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) throw new Error('O build não gerou um DMG válido.');
    const check = run('/usr/bin/hdiutil', ['verify', dmg], { cwd: ROOT, stdio: 'inherit' });
    if (check.error || check.status !== 0) throw new Error('A verificação de integridade do DMG falhou.');
    verified = true;
  } finally {
    clean(verified ? (entry) => entry === name : undefined);
  }
  return dmg;
}

if (require.main === module) {
  try { console.log('\nInstalador:', build()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build };
