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

function registeredPath(terre, value, portable) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  if (path.isAbsolute(value)) return value;
  return portable ? path.resolve(terre, value) : null;
}

async function listSharedLibraries(terreDirectory) {
  const realTerre = await fs.realpath(terreDirectory);
  let configPath;
  let portable;
  for (const name of ['webvideo-plus.json', 'video-export-wrapper.json']) {
    const record = await readJson(path.join(realTerre, name));
    const filename = registeredPath(realTerre, record?.config, record?.portable === true);
    if (!filename) continue;
    const config = await readJson(filename);
    const ownerPath = registeredPath(realTerre, config?.terreDir, config?.portable === true);
    if (!ownerPath) continue;
    const owner = await fs.realpath(ownerPath).catch(() => null);
    if (owner && path.relative(realTerre, owner) === '') {
      configPath = filename;
      portable = config.portable === true;
      break;
    }
  }
  if (!configPath) return [];
  const registry = await readJson(path.join(path.dirname(configPath), 'user-data', 'shared-assets.json'));
  const libraries = [];
  for (const entry of Array.isArray(registry?.libraries) ? registry.libraries : []) {
    if (!supportedKinds.has(entry?.kind) || typeof entry.id !== 'string' || !entry.id) continue;
    const registeredRoot = registeredPath(realTerre, entry.root, portable);
    if (!registeredRoot) continue;
    const root = await fs.realpath(registeredRoot).catch(() => null);
    if (!root || !(await fs.stat(root).catch(() => null))?.isDirectory()) continue;
    const engine = await readJson(path.join(path.dirname(root), 'webgal-engine.json'));
    const engineId = typeof engine?.id === 'string' && engine.id.trim() ? engine.id : 'webgal-lovelive.lovelive';
    libraries.push({
      id: `webvideo-shared:${entry.id}`, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : path.basename(root),
      gameRoot: root, engineId, sharedKind: entry.kind,
    });
  }
  return libraries;
}

module.exports = { listSharedLibraries };
