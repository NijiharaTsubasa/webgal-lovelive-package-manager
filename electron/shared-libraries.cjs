const fs = require('node:fs/promises');
const path = require('node:path');

const supportedKinds = new Set(['all', 'figure', 'background', 'bgm']);

async function readJson(filename) {
  try { return JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

async function listSharedLibraries(terreDirectory) {
  const realTerre = await fs.realpath(terreDirectory);
  let configPath;
  for (const name of ['webvideo-plus.json', 'video-export-wrapper.json']) {
    const record = await readJson(path.join(realTerre, name));
    if (typeof record?.config !== 'string' || !path.isAbsolute(record.config)) continue;
    const config = await readJson(record.config);
    if (typeof config?.terreDir !== 'string' || !path.isAbsolute(config.terreDir)) continue;
    const owner = await fs.realpath(config.terreDir).catch(() => null);
    if (owner && path.relative(realTerre, owner) === '') { configPath = record.config; break; }
  }
  if (!configPath) return [];
  const registry = await readJson(path.join(path.dirname(configPath), 'user-data', 'shared-assets.json'));
  const libraries = [];
  for (const entry of Array.isArray(registry?.libraries) ? registry.libraries : []) {
    if (!supportedKinds.has(entry?.kind) || typeof entry.id !== 'string' || !entry.id ||
        typeof entry.root !== 'string' || !path.isAbsolute(entry.root)) continue;
    const root = await fs.realpath(entry.root).catch(() => null);
    if (!root || !(await fs.stat(root).catch(() => null))?.isDirectory()) continue;
    libraries.push({
      id: `webvideo-shared:${entry.id}`, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : path.basename(root),
      gameRoot: root, engineId: 'webgal-lovelive.lovelive', sharedKind: entry.kind,
    });
  }
  return libraries;
}

module.exports = { listSharedLibraries };
