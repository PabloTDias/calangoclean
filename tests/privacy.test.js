const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {create}=require('../src/privacy');

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'calango-privacy-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[];
  const run=async(command,args)=>{
    calls.push({command,args});
    if(command==='/usr/bin/plutil')return{stdout:await fs.readFile(args.at(-1),'utf8')};
    assert.equal(command,'/usr/bin/open');return{stdout:''};
  };
  async function app(name='Google Chrome',id='com.google.Chrome'){
    const bundle=path.join(root,`${name}.app`);await fs.mkdir(path.join(bundle,'Contents'),{recursive:true});
    await fs.writeFile(path.join(bundle,'Contents/Info.plist'),id);return bundle;
  }
  const manager=create({roots:[root],run});return{root,calls,app,manager,run};
}

test('lista navegadores sem abrir apps nem ler bancos de navegação',async t=>{
  const f=await fixture(t);await f.app();await f.app('Safari','com.apple.Safari');await f.app('Comet','ai.perplexity.comet');
  const result=await f.manager.list();assert.deepEqual(result.browsers.map(b=>b.id),['chrome','safari','comet']);
  assert.equal(JSON.stringify(result).includes(f.root),false);
  assert.ok(f.calls.every(call=>call.command==='/usr/bin/plutil'));
});
test('abre somente a tela fixa do navegador selecionado e não afirma exclusão',async t=>{
  const f=await fixture(t);const bundle=await f.app();await f.manager.list();
  const result=await f.manager.open('chrome','https://example.com/evil');
  assert.equal(result.deleted,false);assert.equal(result.opened,true);
  assert.deepEqual(f.calls.at(-1),{command:'/usr/bin/open',args:['-a',bundle,'chrome://settings/clearBrowserData']});
});
test('Safari abre sem automação de menus nem exclusão automática',async t=>{
  const f=await fixture(t);const bundle=await f.app('Safari','com.apple.Safari');const result=await f.manager.list();
  assert.match(result.browsers[0].instructions,/Histórico/);await f.manager.open('safari');
  assert.deepEqual(f.calls.at(-1),{command:'/usr/bin/open',args:['-a',bundle]});
});
test('IDs arbitrários, identidade alterada e symlinks nunca abrem apps',async t=>{
  const f=await fixture(t);const bundle=await f.app();await f.manager.list();
  for(const id of ['../Chrome','https://example.com',{},'firefox'])assert.equal((await f.manager.open(id)).ok,false);
  await fs.writeFile(path.join(bundle,'Contents/Info.plist'),'com.fake.browser');
  assert.equal((await f.manager.open('chrome')).ok,false);
  await fs.rm(bundle,{recursive:true});const other=path.join(f.root,'Other');await fs.mkdir(other);await fs.symlink(other,bundle);
  assert.equal((await f.manager.list()).browsers.length,0);
  assert.equal(f.calls.some(call=>call.command==='/usr/bin/open'),false);
});
