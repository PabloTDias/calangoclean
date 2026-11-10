// Ocupação de discos externos, somente por clique e somente leitura.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

function create({ listVolumes, io = fs, execute = execFile, volumesDir = '/Volumes', now = Date.now } = {}) {
  const cache = new Map();
  const running = new Map();
  const ignored = new Set(['.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', '.DocumentRevisions-V100']);
  const identity = (volume, stat) => JSON.stringify([volume.id, volume.path, volume.uuid, String(stat.dev), String(stat.ino)]);
  async function resolve(id) {
    if (typeof id !== 'string' || !/^disk\d+(?:s\d+)*$/.test(id)) throw Error('Selecione um disco externo conectado.');
    const volume = (await listVolumes()).find(item => item.id === id);
    if (!volume || path.dirname(volume.path) !== volumesDir || path.resolve(volume.path) !== volume.path) throw Error('O disco externo não está mais conectado.');
    const stat = await io.lstat(volume.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await io.realpath(volume.path) !== volume.path) throw Error('Não foi possível validar o disco externo.');
    return { volume, stat, key: identity(volume, stat) };
  }
  function cancel(id) {
    const jobs = id === undefined ? [...running.values()] : [running.get(id)].filter(Boolean);
    for (const job of jobs) { job.cancelled = true; for (const child of job.children) child.kill(); }
  }
  async function last(id) {
    try { const target = await resolve(id); return { ok: true, result: cache.get(target.key) || null }; }
    catch (error) { return { ok: false, error: error.message }; }
  }
  function measure(target, job) {
    return new Promise(resolve => {
      let child;
      child = execute('/usr/bin/du', ['-skPx', target], { timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        job.children.delete(child);
        const match = String(stdout || '').match(/^\s*(\d+)\t/);
        const bytes = match ? Number(match[1]) * 1024 : null;
        resolve({ bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null, partial: Boolean(error) });
      });
      job.children.add(child);
      if (job.cancelled) child.kill();
    });
  }
  async function scan(id, job) {
    const target = await resolve(id);
    const entries = await io.readdir(target.volume.path, { withFileTypes: true });
    let partial = entries.length > 1024;
    let index = 0;
    let rootFiles = 0;
    const items = [];
    const candidates = entries.slice(0, 1024).filter(entry => !ignored.has(entry.name) && !entry.isSymbolicLink());
    async function worker() {
      while (index < candidates.length && !job.cancelled) {
        const entry = candidates[index++];
        if (/[\x00-\x1f\x7f]/.test(entry.name)) { partial = true; continue; }
        const file = path.join(target.volume.path, entry.name);
        try {
          const stat = await io.lstat(file);
          if (stat.isSymbolicLink() || stat.dev !== target.stat.dev) { partial = true; continue; }
          if (stat.isDirectory()) {
            const measured = await measure(file, job);
            if (job.cancelled) break;
            const after = await io.lstat(file);
            if (after.dev !== stat.dev || after.ino !== stat.ino || after.isSymbolicLink()) throw Error('Pasta alterada.');
            if (measured.bytes === null) { partial = true; continue; }
            partial ||= measured.partial;
            items.push({ id: crypto.createHash('sha256').update(entry.name).digest('hex').slice(0, 16), label: entry.name, ...measured });
          } else if (stat.isFile()) rootFiles += Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size;
        } catch { partial = true; }
      }
    }
    await Promise.all([worker(), worker()]);
    if (job.cancelled) return { ok: false, cancelled: true };
    const current = await resolve(id);
    if (current.key !== target.key) throw Error('O disco foi removido ou substituído durante a análise.');
    if (rootFiles) items.push({ id: 'root-files', label: 'Arquivos na raiz', bytes: rootFiles, partial: false });
    items.sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label, 'pt-BR'));
    const detailed = items.slice(0, 6);
    const remainder = items.slice(6).reduce((sum, item) => sum + item.bytes, 0);
    if (remainder) detailed.push({ id: 'other-folders', label: 'Outras pastas', bytes: remainder, partial: items.slice(6).some(item => item.partial) });
    const measured = items.reduce((sum, item) => sum + item.bytes, 0);
    const unknown = Math.max(0, current.volume.used - measured);
    if (unknown) detailed.push({ id: 'undetailed', label: 'Sistema e não detalhado', bytes: unknown, partial });
    const result = { at: new Date(now()).toISOString(), used: current.volume.used, items: detailed, partial,
      note: partial ? 'Análise parcial: algumas pastas não puderam ser medidas ou mudaram durante a leitura.' : 'Espaço alocado por pastas; o macOS pode contabilizar snapshots e espaço compartilhado separadamente.' };
    // Bounded cache, tied to the identity of the mounted filesystem.
    cache.delete(current.key); cache.set(current.key, result);
    while (cache.size > 12) cache.delete(cache.keys().next().value);
    return { ok: true, result };
  }
  function analyze(id) {
    if (running.has(id)) return running.get(id).promise;
    // Avoid competing full-disk scans.
    if (running.size) return Promise.resolve({ ok: false, error: 'Aguarde a análise do outro disco terminar.' });
    const job = { children: new Set(), cancelled: false, promise: null };
    running.set(id, job);
    job.promise = scan(id, job).catch(error => job.cancelled ? { ok: false, cancelled: true } : { ok: false, error: error.message || 'Não foi possível analisar o disco.' }).finally(() => running.delete(id));
    return job.promise;
  }
  return { analyze, last, cancel };
}

module.exports = { create };
