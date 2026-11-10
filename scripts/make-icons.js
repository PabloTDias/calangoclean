// Gera os ícones do calangoclean a partir das imagens-base em assets/ (rodar com o Electron, que decodifica PNG):
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/make-icons.js
//  - build/icon.png (1024x1024), build/icon.icns e ui/app-icon.png (256x256):
//    composição completa de assets/Icone CalangoClean.png, em um quadrado arredondado
//    de 824x824 centralizado no canvas transparente padrão do macOS;
//  - ui/favicon.png (128x128): assets/FiveIcon Calango.png, com cores e transparência;
//  - assets/iconTemplate.png (18) e iconTemplate@2x.png (36): o calango varrendo
//    (assets/calangoclean-silhueta.png) em silhueta preta, para o macOS pintar a barra de menu conforme o tema.
// A máscara corporativa ui/calangoclean-silhueta.png, usada no rodapé, é independente.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { app, nativeImage } = require('electron');

const ROOT = path.join(__dirname, '..');

// ---------- PNG RGBA (sem dependências) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rgba: Buffer RGBA (não pré-multiplicado)
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- utilitários de imagem ----------
function load(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw new Error(`Não foi possível ler a imagem: ${file}`);
  const { width, height } = img.getSize();
  return { img, width, height, bgra: img.toBitmap() };
}
function fromBgra(width, height, bgra) {
  return nativeImage.createFromBitmap(bgra, { width, height });
}
const resize = (img, w, h) => img.resize({ width: w, height: h, quality: 'best' });

// ---------- ícone do app ----------
function makeAppIcon() {
  const src = load(path.join(ROOT, 'assets', 'Icone CalangoClean.png'));
  if (src.width !== src.height) throw new Error('O ícone do aplicativo precisa ser quadrado para preservar a composição.');
  const SIDE = 824, SIZE = 1024, OFF = (SIZE - SIDE) / 2;
  // Preserva a imagem fornecida inteira, incluindo sua margem branca.
  const side = resize(src.img, SIDE, SIDE);
  const px = side.toBitmap();

  // Máscara de ícone do macOS: retângulo arredondado (raio ≈ 22,4% do lado), com 4x4 de supersampling nas bordas.
  const R = SIDE * 0.2237;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, R), SIDE - R), cy = Math.min(Math.max(y, R), SIDE - R);
    return Math.hypot(x - cx, y - cy) <= R;
  };
  const coverage = (x, y) => {
    const cx = Math.min(Math.max(x + 0.5, R), SIDE - R), cy = Math.min(Math.max(y + 0.5, R), SIDE - R);
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d < R - 1.5) return 1;
    if (d > R + 1.5) return 0;
    let n = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) n += inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4) ? 1 : 0;
    return n / 16;
  };

  const out = Buffer.alloc(SIZE * SIZE * 4); // RGBA transparente
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = (y * SIDE + x) * 4;
      const sourceAlpha = px[i + 3] / 255;
      // toBitmap usa BGRA pré-multiplicado; encodePng recebe RGBA normal.
      const r = sourceAlpha ? Math.min(255, Math.round(px[i + 2] / sourceAlpha)) : 0;
      const g = sourceAlpha ? Math.min(255, Math.round(px[i + 1] / sourceAlpha)) : 0;
      const b = sourceAlpha ? Math.min(255, Math.round(px[i] / sourceAlpha)) : 0;
      const a = sourceAlpha * coverage(x, y);
      const o = ((y + OFF) * SIZE + (x + OFF)) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(a * 255);
    }
  }
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  const png1024 = path.join(ROOT, 'build', 'icon.png');
  fs.writeFileSync(png1024, encodePng(SIZE, SIZE, out));
  fs.writeFileSync(path.join(ROOT, 'ui', 'app-icon.png'), resize(load(png1024).img, 256, 256).toPNG());

  // .icns: iconset -> iconutil
  const set = path.join(ROOT, 'build', 'icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  const sizes = [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]];
  for (const [s, k] of sizes) {
    const name = `icon_${s}x${s}${k === 2 ? '@2x' : ''}.png`;
    execFileSync('sips', ['-z', String(s * k), String(s * k), png1024, '--out', path.join(set, name)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ROOT, 'build', 'icon.icns')]);
  fs.rmSync(set, { recursive: true, force: true });
  console.log('build/icon.png, build/icon.icns e ui/app-icon.png gerados de Icone CalangoClean.png');
}

// ---------- favicon e silhueta da barra de menu ----------
function makeSilhouette() {
  const fav = load(path.join(ROOT, 'assets', 'FiveIcon Calango.png'));
  if (fav.width !== fav.height) throw new Error('O favicon precisa ser quadrado para preservar a composição.');
  fs.writeFileSync(path.join(ROOT, 'ui', 'favicon.png'), resize(fav.img, 128, 128).toPNG());
  // Barra de menu: calango varrendo (silhueta preta com fundo transparente).
  const src = load(path.join(ROOT, 'assets', 'calangoclean-silhueta.png'));
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.bgra[(y * src.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x0 > x1 || y0 > y1) throw new Error('O favicon está completamente transparente.');
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.max(bw, bh);
  console.log(`silhueta: ${bw}x${bh}`);
  // Quadrado transparente com a lagartixa centralizada; o template usa apenas o alfa.
  const sq = Buffer.alloc(side * side * 4);
  const ox = Math.floor((side - bw) / 2), oy = Math.floor((side - bh) / 2);
  for (let y = 0; y < bh; y++) {
    src.bgra.copy(sq, ((y + oy) * side + ox) * 4, ((y + y0) * src.width + x0) * 4, ((y + y0) * src.width + x0 + bw) * 4);
  }
  const base = fromBgra(side, side, sq);
  const blackRgba = (img, size) => {
    const px = img.toBitmap();
    const out = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) out[i * 4 + 3] = px[i * 4 + 3]; // RGB = 0 (preto), só o alfa importa
    return encodePng(size, size, out);
  };
  // Template images da barra de menu: 18 e 36 px, com 1 px (2 px no @2x) de folga.
  for (const [size, file] of [[18, 'iconTemplate.png'], [36, 'iconTemplate@2x.png']]) {
    const pad = size / 18;
    const inner = size - 2 * pad;
    const small = resize(base, inner, inner).toBitmap();
    const full = Buffer.alloc(size * size * 4);
    for (let y = 0; y < inner; y++) small.copy(full, ((y + pad) * size + pad) * 4, y * inner * 4, (y + 1) * inner * 4);
    fs.writeFileSync(path.join(ROOT, 'assets', file), blackRgba(fromBgra(size, size, full), size));
  }
  console.log('ui/favicon.png e assets/iconTemplate*.png gerados (favicon: FiveIcon Calango.png; barra de menu: calangoclean-silhueta.png)');
}

app.whenReady().then(() => {
  makeAppIcon();
  makeSilhouette();
  app.quit();
}).catch(error => {
  console.error(error.message);
  app.exit(1);
});
