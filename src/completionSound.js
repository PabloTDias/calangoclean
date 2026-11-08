const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const SOUND = path.join(__dirname, '..', 'assets', 'completion.wav').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');

function create({ config, play = () => run('/usr/bin/afplay', ['-v', '0.35', SOUND], { timeout: 3000, maxBuffer: 4096 }) }) {
  let playing = false;
  async function get() {
    const { cfg, error } = await config.loadSafe();
    return { enabled: !error && cfg.soundEnabled !== false, ...(error ? { error } : {}) };
  }
  async function set(enabled) {
    if(typeof enabled !== 'boolean')return {ok:false,error:'Escolha ligar ou desligar o som.'};
    try {
      await config.update(cfg=>{cfg.soundEnabled=enabled;});
      return {ok:true,enabled};
    } catch { return {ok:false,...await get(),error:'Não foi possível salvar a preferência de som.'}; }
  }
  async function complete() {
    if(playing)return {ok:true,played:false};
    playing=true;
    try {
      const state=await get();
      if(!state.enabled)return {ok:true,played:false};
      await play();
      return {ok:true,played:true};
    } catch { return {ok:false,played:false}; }
    finally { playing=false; }
  }
  return {get,set,complete};
}

module.exports={create};
