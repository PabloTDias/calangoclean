// Abre apenas os controles nativos de privacidade. Não lê histórico/cookies nem
// remove dados do navegador; período, perfil e exclusão são confirmados nele.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const DEFINITIONS = [
  {id:'chrome',name:'Google Chrome',bundle:'com.google.Chrome',url:'chrome://settings/clearBrowserData'},
  {id:'chromeBeta',name:'Google Chrome Beta',bundle:'com.google.Chrome.beta',url:'chrome://settings/clearBrowserData'},
  {id:'edge',name:'Microsoft Edge',bundle:'com.microsoft.edgemac',url:'edge://settings/clearBrowserData'},
  {id:'brave',name:'Brave Browser',bundle:'com.brave.Browser',url:'brave://settings/clearBrowserData'},
  {id:'firefox',name:'Firefox',bundle:'org.mozilla.firefox',url:'about:preferences#privacy',guide:'Nas opções de Privacidade e Segurança, procure Limpar dados de navegação ou Limpar dados.'},
  {id:'safari',name:'Safari',bundle:'com.apple.Safari',guide:'Para o histórico: Histórico → Limpar Histórico. Para cookies: Safari → Ajustes → Privacidade → Gerenciar Dados de Sites.'},
  {id:'comet',name:'Comet',bundle:'ai.perplexity.comet',guide:'Abra as configurações do Comet e procure a opção de limpar dados de navegação.'},
  {id:'vivaldi',name:'Vivaldi',bundle:'com.vivaldi.Vivaldi',guide:'No menu do navegador, abra as opções de histórico e limpeza de dados de navegação.'},
  {id:'opera',name:'Opera',bundle:'com.operasoftware.Opera',guide:'Nas configurações do navegador, procure a opção de limpar dados de navegação.'},
  {id:'arc',name:'Arc',bundle:'company.thebrowser.Browser',guide:'Nas configurações do navegador, procure as opções de privacidade e limpeza de dados de navegação.'},
];

function create({roots=['/Applications',path.join(os.homedir(),'Applications'),'/System/Applications','/System/Cryptexes/App/System/Applications'],run=execute,getIcon=async()=>null}={}) {
  const allowedRoots=roots.map(root=>path.resolve(root));
  let entries=new Map();
  async function inspect(def,bundle) {
    if(!allowedRoots.includes(path.dirname(bundle)))throw Error('invalid root');
    const rootStat=await fs.lstat(path.dirname(bundle));
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('invalid root');
    const before=await fs.lstat(bundle);
    if(!before.isDirectory()||before.isSymbolicLink())throw Error('invalid bundle');
    const real=await fs.realpath(bundle);
    const realRoot=await fs.realpath(path.dirname(bundle));
    if(path.dirname(real)!==realRoot)throw Error('invalid path');
    const plist=path.join(bundle,'Contents','Info.plist');
    const info=await fs.lstat(plist);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1048576||await fs.realpath(plist)!==path.join(real,'Contents','Info.plist'))throw Error('invalid plist');
    const {stdout}=await run('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',plist],{timeout:5000,maxBuffer:1024});
    if(stdout.trim()!==def.bundle)throw Error('invalid identity');
    const after=await fs.lstat(bundle);
    if(before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs)throw Error('changed');
    return {dev:after.dev,ino:after.ino,real};
  }
  async function list() {
    const found=new Map();
    for(const def of DEFINITIONS)for(const root of allowedRoots) {
      const bundle=path.join(root,`${def.name}.app`);
      try {
        const identity=await inspect(def,bundle);
        let icon=null;try {icon=await getIcon(identity.real);}catch{}
        found.set(def.id,{def,bundle,identity,icon});break;
      }catch{}
    }
    entries=found;
    return {ok:true,browsers:[...found.values()].map(({def,icon})=>({id:def.id,name:def.name,icon,
      actionLabel:def.url?'Abrir opções de limpeza':'Abrir navegador',
      instructions:def.guide||'Confira o perfil, escolha o período e marque os dados que deseja remover. Confirme a exclusão no navegador.'}))};
  }
  async function open(id) {
    const entry=typeof id==='string'?entries.get(id):null;
    if(!entry)return {ok:false,error:'Escolha um navegador da lista. Atualize se necessário.'};
    try {
      const current=await inspect(entry.def,entry.bundle);
      if(current.dev!==entry.identity.dev||current.ino!==entry.identity.ino||current.real!==entry.identity.real)throw Error('changed');
      const args=['-a',entry.bundle];if(entry.def.url)args.push(entry.def.url);
      await run('/usr/bin/open',args,{timeout:10000,maxBuffer:4096});
      return {ok:true,opened:true,deleted:false,message:`${entry.def.name} aberto. Escolha o período e confirme os dados a excluir no navegador.`};
    }catch{return {ok:false,error:'Não foi possível abrir essas opções. Atualize a lista e tente novamente.'};}
  }
  return {list,open};
}

module.exports={create};
