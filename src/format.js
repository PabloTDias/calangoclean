// Tamanhos em base 10 (1 KB = 1000 bytes), igual ao Finder, em pt-BR com uma casa decimal.
const int0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function fmt(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  let i = Math.min(Math.floor(Math.log10(bytes) / 3), UNITS.length - 1);
  if (Number((bytes / 1000 ** i).toFixed(1)) >= 1000 && i < UNITS.length - 1) i++; // 999,96 KB -> 1,0 MB
  const v = bytes / 1000 ** i;
  return `${i === 0 ? int0.format(v) : num1.format(v)} ${UNITS[i]}`;
}

const days = (n) => `${int0.format(n)} ${n === 1 ? 'dia' : 'dias'}`;

module.exports = { fmt, days };
