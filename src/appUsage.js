// Última abertura registrada pelo Spotlight. Ausência de data não significa nunca usado.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function parseLastUsed(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(raw)) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) && time >= 0 && time <= now + 60000 ? new Date(time).toISOString() : null;
}

async function readLastUsed(bundle) {
  try {
    const { stdout } = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemLastUsedDate', bundle], { timeout: 3000, maxBuffer: 4096 });
    return parseLastUsed(stdout);
  } catch { return null; }
}

module.exports = { readLastUsed, parseLastUsed };
