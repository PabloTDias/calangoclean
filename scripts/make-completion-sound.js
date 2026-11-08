// Sinal curto e suave de conclusão, gerado localmente sem áudio de terceiros.
const fs = require('node:fs');
const path = require('node:path');
const rate = 44100;
const samples = Math.floor(rate * 0.52);
const data = Buffer.alloc(44 + samples * 2);
data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32);
data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
for(let index=0;index<samples;index++) {
  const time=index/rate;
  let value=0;
  for(const [start,frequency] of [[0,659.255],[0.115,880]]) {
    const age=time-start;
    if(age<0)continue;
    const envelope=Math.min(age/0.008,1)*Math.exp(-age*13)*Math.min((0.52-time)/0.025,1);
    value+=envelope*(Math.sin(2*Math.PI*frequency*age)+0.16*Math.sin(2*Math.PI*frequency*2*age))*0.25;
  }
  data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),44+index*2);
}
fs.writeFileSync(path.join(__dirname,'..','assets','completion.wav'),data);
