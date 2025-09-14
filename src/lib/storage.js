const fsp = require('fs/promises');
const path = require('path');
const locks = new Map();
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }
async function readJson(filepath, fallback = {}) {
  try { const raw = await fsp.readFile(filepath, 'utf8'); return JSON.parse(raw); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function writeFileAtomic(filepath, data) {
  const dir = path.dirname(filepath); await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(filepath)}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, data, 'utf8'); await fsp.rename(tmp, filepath);
}
async function writeJsonAtomic(filepath, obj) {
  const json = JSON.stringify(obj, null, 2);
  while (locks.get(filepath)) { await new Promise(r => setTimeout(r, 25)); }
  locks.set(filepath, true);
  try { await writeFileAtomic(filepath, json); } finally { locks.delete(filepath); }
}
module.exports = { readJson, writeJsonAtomic };