// Gera os ícones do calangoclean a partir das imagens-base em assets/ (rodar com o Electron, que decodifica PNG):
//   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/make-icons.js
//  - build/icon.png (1024x1024) e build/icon.icns: calangoclean-icon-base.png recortado pelo próprio quadrado
//    arredondado (fora dele fica transparente), 824x824 centralizado no canvas, cantos no formato dos ícones do macOS;
//  - assets/iconTemplate.png (18) e iconTemplate@2x.png (36): silhueta preta (template image da barra de menu);
//  - ui/calangoclean-silhueta.png (64): máscara usada no rodapé (a cor vem do CSS).
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
  const { width, height } = img.getSize();
  return { img, width, height, bgra: img.toBitmap() };
}
function fromBgra(width, height, bgra) {
  return nativeImage.createFromBitmap(bgra, { width, height });
}
function bgraToRgba(bgra) {
  const out = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2]; out[i + 1] = bgra[i + 1]; out[i + 2] = bgra[i]; out[i + 3] = bgra[i + 3];
  }
  return out;
}
const resize = (img, w, h) => img.resize({ width: w, height: h, quality: 'best' });

// ---------- ícone do app ----------
function makeAppIcon() {
  const src = load(path.join(ROOT, 'assets', 'calangoclean-icon-base.png'));
  // Caixa do quadrado arredondado: tudo que não é o preto dos cantos (base nova, de 06/11/2026).
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 4; y < src.height - 4; y++) { // ignora a moldura de 1 px da imagem
    for (let x = 4; x < src.width - 4; x++) {
      const o = (y * src.width + x) * 4;
      if (Math.max(src.bgra[o], src.bgra[o + 1], src.bgra[o + 2]) > 28) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  console.log(`quadrado detectado: x ${x0}..${x1}, y ${y0}..${y1} (${bw}x${bh})`);
  const SIDE = 824, SIZE = 1024, OFF = (SIZE - SIDE) / 2;
  const L = Math.min(Math.max(bw, bh), src.width, src.height); // recorte quadrado, centrado no quadrado detectado
  const cx0 = Math.min(Math.max(Math.round((x0 + x1 + 1 - L) / 2), 0), src.width - L), cy0 = Math.min(Math.max(Math.round((y0 + y1 + 1 - L) / 2), 0), src.height - L);
  const side = resize(src.img.crop({ x: cx0, y: cy0, width: L, height: L }), SIDE, SIDE);
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
      let b = px[i], g = px[i + 1], r = px[i + 2];
      let a = 1; // fundo preto fora do quadrado: a máscara de cantos abaixo faz o recorte
      a *= coverage(x, y);
      const o = ((y + OFF) * SIZE + (x + OFF)) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = Math.round(a * 255);
    }
  }
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  const png1024 = path.join(ROOT, 'build', 'icon.png');
  fs.writeFileSync(png1024, encodePng(SIZE, SIZE, out));

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
  console.log('build/icon.png e build/icon.icns gerados');
}

// ---------- silhueta: barra de menu e rodapé ----------
function makeSilhouette() {
  const src = load(path.join(ROOT, 'assets', 'calangoclean-silhueta.png'));
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.bgra[(y * src.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.max(bw, bh);
  console.log(`silhueta: ${bw}x${bh}`);
  // Quadrado transparente com a silhueta centralizada (BGRA; a silhueta é preta, então pré-multiplicado = normal).
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
  // Máscara do rodapé (64 px, sem folga; a cor vem do CSS).
  fs.writeFileSync(path.join(ROOT, 'ui', 'calangoclean-silhueta.png'), blackRgba(resize(base, 64, 64), 64));
  console.log('assets/iconTemplate*.png e ui/calangoclean-silhueta.png gerados');
}

app.whenReady().then(() => {
  makeAppIcon();
  makeSilhouette();
  app.quit();
});
