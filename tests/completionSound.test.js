const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { create } = require('../src/completionSound');

function fixture() {
  const state={cfg:{soundEnabled:true,other:'preservado'},error:null,played:0};
  const config={loadSafe:async()=>({cfg:state.cfg,error:state.error}),update:async fn=>{if(state.error)throw Error(state.error);fn(state.cfg);return state.cfg;}};
  const controller=create({config,play:async()=>{state.played++;}});
  return {state,controller,config};
}

test('som só toca por pedido explícito e respeita preferência compartilhada',async()=>{
  const f=fixture();assert.equal(f.state.played,0);
  assert.equal((await f.controller.complete()).played,true);
  await f.controller.set(false);
  assert.equal((await f.controller.complete()).played,false);
  assert.equal(f.state.played,1);assert.equal(f.state.cfg.other,'preservado');
  await f.controller.set(true);assert.equal((await f.controller.complete()).played,true);
});

test('configuração ilegível e valores inválidos não alteram preferência nem tocam áudio',async()=>{
  const f=fixture();
  for(const value of ['false',null,{},1])assert.equal((await f.controller.set(value)).ok,false);
  f.state.error='config inválida';
  assert.equal((await f.controller.complete()).played,false);
  assert.equal((await f.controller.set(false)).ok,false);
  assert.equal(f.state.cfg.soundEnabled,true);assert.equal(f.state.played,0);
});

test('conclusões simultâneas não sobrepõem sons e falha de áudio é não fatal',async()=>{
  const f=fixture();let release;
  const controller=create({config:f.config,play:()=>new Promise(resolve=>{release=resolve;})});
  const first=controller.complete();await Promise.resolve();await Promise.resolve();
  assert.equal((await controller.complete()).played,false);release();assert.equal((await first).played,true);
  const failed=create({config:f.config,play:async()=>{throw Error('áudio indisponível');}});
  assert.equal((await failed.complete()).ok,false);
});

test('recurso sonoro é um WAV curto e permanece disponível fora do ASAR',async()=>{
  const bytes=await fs.readFile(path.join(__dirname,'../assets/completion.wav'));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  const duration=bytes.readUInt32LE(40)/bytes.readUInt32LE(28);
  assert.ok(duration>0.2&&duration<0.8);
  const pkg=require('../package.json');
  assert.ok(pkg.build.files.includes('assets/completion.wav'));assert.ok(pkg.build.asarUnpack.includes('assets/completion.wav'));
});
