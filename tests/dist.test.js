const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/dist');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calango-dist-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(root, 'preservar.txt'), 'fora de dist');
  const dist = path.join(root, 'dist');
  const dmg = path.join(dist, 'CalangoClean-1.2.3-universal.dmg');
  function generated() {
    fs.mkdirSync(path.join(dist, 'mac-universal', 'CalangoClean.app'), { recursive: true });
    fs.writeFileSync(dmg, 'fixture DMG; nenhum instalador real é gerado');
    fs.writeFileSync(path.join(dist, 'builder-debug.yml'), 'intermediário');
  }
  return { root, dist, dmg, generated };
}

test('build validado mantém somente o DMG novo e preserva arquivos fora de dist', t => {
  const f = fixture(t);
  fs.mkdirSync(f.dist);
  fs.writeFileSync(path.join(f.dist, 'versao-anterior.dmg'), 'anterior');
  let verified = false;
  const dmg = build({ root: f.root, run: (command, args) => {
    if (command.endsWith('electron-builder')) f.generated();
    else {
      assert.equal(command, '/usr/bin/hdiutil');
      assert.deepEqual(args, ['verify', fs.realpathSync(f.dmg)]);
      verified = true;
    }
    return { status: 0 };
  } });
  assert.equal(verified, true);
  assert.equal(dmg, fs.realpathSync(f.dmg));
  assert.deepEqual(fs.readdirSync(f.dist), [path.basename(f.dmg)]);
  assert.equal(fs.readFileSync(path.join(f.root, 'preservar.txt'), 'utf8'), 'fora de dist');
});

for (const failure of ['builder', 'integridade']) {
  test(`falha de ${failure} remove pacotes intermediários e DMG incompleto`, t => {
    const f = fixture(t);
    assert.throws(() => build({ root: f.root, run: command => {
      const builder = command.endsWith('electron-builder');
      if (builder) f.generated();
      return { status: (failure === 'builder' ? builder : !builder) ? 1 : 0 };
    } }), /Falha|integridade/);
    assert.deepEqual(fs.readdirSync(f.dist), []);
    assert.equal(fs.readFileSync(path.join(f.root, 'preservar.txt'), 'utf8'), 'fora de dist');
  });
}

for (const dangling of [false, true]) {
  test(`recusa dist como link${dangling ? ' pendente' : ''} sem executar build nem apagar destino`, t => {
    const f = fixture(t);
    const external = path.join(f.root, 'outra-pasta');
    if (!dangling) {
      fs.mkdirSync(external);
      fs.writeFileSync(path.join(external, 'manter.txt'), 'preservar');
    }
    fs.symlinkSync(external, f.dist);
    assert.throws(() => build({ root: f.root, run: () => assert.fail('Não deve executar comandos') }), /pasta real/);
    assert.equal(fs.lstatSync(f.dist).isSymbolicLink(), true);
    if (!dangling) assert.equal(fs.readFileSync(path.join(external, 'manter.txt'), 'utf8'), 'preservar');
  });
}
