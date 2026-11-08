// Lista positiva: componentes de software e tipos desconhecidos nem são abertos.
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff', '.gif', '.bmp', '.avif']);
const CATEGORIES = {
  document: ['.pdf', '.txt', '.rtf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.csv', '.tsv', '.epub'],
  audio: ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.aiff', '.aif'],
  video: ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm'],
  archive: ['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz'],
};
const FILE_KINDS = new Map(Object.entries(CATEGORIES).flatMap(([kind, extensions]) => extensions.map(ext => [ext, kind])));
const TEXT_EXTENSIONS = new Set(['.txt', '.csv', '.tsv']);
const ZIP_EXTENSIONS = new Set(['.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub']);
const ISO_MEDIA = new Set(['.mp4', '.mov', '.m4v', '.m4a']);
const HEX_SOFTWARE = new Set(['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

function kindFor(extension, mode) {
  return mode === 'photos' ? IMAGE_EXTENSIONS.has(extension) ? 'photo' : null : FILE_KINDS.get(extension) || null;
}

function isSoftwareHeader(buffer) {
  const first = buffer.subarray(0, 4).toString('hex');
  if (buffer.toString('ascii', 0, 2) === 'MZ' || HEX_SOFTWARE.has(first)) return true;
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).replace(/^\uFEFF/, '').trimStart();
  return /^(?:#!|@echo\s+off\b|<script\b|<\?php\b)/i.test(text);
}

function isImageHeader(buffer, ext) {
  if (ext === '.jpg' || ext === '.jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (ext === '.png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.gif') return /^GIF8[79]a/.test(buffer.toString('ascii', 0, 6));
  if (ext === '.bmp') return buffer.toString('ascii', 0, 2) === 'BM';
  if (ext === '.webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (ext === '.tif' || ext === '.tiff') return ['49492a00', '4d4d002a', '49492b00', '4d4d002b'].includes(buffer.subarray(0, 4).toString('hex'));
  if (['.heic', '.heif', '.avif'].includes(ext)) return buffer.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1|avif|avis/.test(buffer.toString('ascii', 8, 64));
  return false;
}

function isCompatibleHeader(buffer, ext) {
  if (isSoftwareHeader(buffer)) return false;
  if (IMAGE_EXTENSIONS.has(ext)) return isImageHeader(buffer, ext);
  if (TEXT_EXTENSIONS.has(ext)) return !buffer.includes(0);
  if (ext === '.pdf') return buffer.toString('ascii', 0, 5) === '%PDF-';
  if (ext === '.rtf') return buffer.toString('ascii', 0, 5) === '{\\rtf';
  if (ZIP_EXTENSIONS.has(ext)) return ['504b0304', '504b0506', '504b0708'].includes(buffer.subarray(0, 4).toString('hex'));
  if (ISO_MEDIA.has(ext)) return buffer.toString('ascii', 4, 8) === 'ftyp' || ext === '.mov' && ['moov', 'mdat', 'wide'].includes(buffer.toString('ascii', 4, 8));
  if (ext === '.mp3') return buffer.toString('ascii', 0, 3) === 'ID3' || buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0;
  if (ext === '.aac') return buffer[0] === 255 && (buffer[1] & 0xf6) === 0xf0;
  if (ext === '.wav') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (ext === '.flac') return buffer.toString('ascii', 0, 4) === 'fLaC';
  if (ext === '.ogg') return buffer.toString('ascii', 0, 4) === 'OggS';
  if (ext === '.aiff' || ext === '.aif') return buffer.toString('ascii', 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(buffer.toString('ascii', 8, 12));
  if (ext === '.mkv' || ext === '.webm') return buffer.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (ext === '.avi') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'AVI ';
  if (ext === '.7z') return buffer.subarray(0, 6).toString('hex') === '377abcaf271c';
  if (ext === '.rar') return ['526172211a0700', '526172211a0701'].includes(buffer.subarray(0, 7).toString('hex'));
  if (ext === '.tar') return buffer.toString('ascii', 257, 262) === 'ustar';
  if (ext === '.gz') return buffer.subarray(0, 3).toString('hex') === '1f8b08';
  if (ext === '.bz2') return /^BZh[1-9]/.test(buffer.toString('ascii', 0, 4));
  if (ext === '.xz') return buffer.subarray(0, 6).toString('hex') === 'fd377a585a00';
  return false;
}

// A validação de texto é incremental: limita memória e pega binários escondidos
// depois do primeiro bloco, sem depender apenas da extensão ou do prefixo.
function contentValidator(extension) {
  const decoder = TEXT_EXTENSIONS.has(extension) ? new TextDecoder('utf-8', { fatal: true }) : null;
  return {
    chunk(buffer) {
      if (!decoder) return;
      if (buffer.some(byte => byte < 9 || byte > 13 && byte < 32 || byte === 127)) throw new Error('Conteúdo binário incompatível com documento de texto.');
      decoder.decode(buffer, { stream: true });
    },
    finish() { if (decoder) decoder.decode(); },
  };
}

module.exports = { kindFor, isCompatibleHeader, contentValidator, IMAGE_EXTENSIONS };
