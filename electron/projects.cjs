const fs = require('node:fs/promises');
const path = require('node:path');
const { userError } = require('./user-error.cjs');

function inside(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function projectPath(gamesRoot, id) {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || /[/\\:]/.test(id)) {
    throw Error('无效工程名称');
  }
  return path.join(gamesRoot, id, 'game');
}
async function gameRoot(gamesRoot, id) {
  const realGames = await fs.realpath(gamesRoot);
  const realGame = await fs.realpath(projectPath(gamesRoot, id));
  if (!inside(realGames, realGame)) throw Error('工程路径超出 games 目录');
  if (!(await fs.stat(realGame)).isDirectory()) throw Error('工程缺少 game 目录');
  return realGame;
}
async function listProjects(gamesRoot) {
  let entries;
  try { entries = await fs.readdir(gamesRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { gamesRoot, projects: [] }; throw error; }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      projects.push(await readProject(path.join(gamesRoot, entry.name)));
    } catch (error) {
      if (error.code === 'ENOENT' || error.invalidProject) continue;
      throw error;
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { gamesRoot, projects };
}
async function readProject(directory) {
  let root = await fs.realpath(directory);
  if (path.basename(root).toLowerCase() === 'game') {
    try { await fs.access(path.join(root, 'webgal-engine.json')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      root = path.dirname(root);
    }
  }
  const filename = path.join(root, 'webgal-engine.json');
  let engine;
  try { engine = JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const missing = Error(`所选目录缺少 webgal-engine.json，请选择 WebGAL 工程目录或其中的 game 目录。\n位置：${root}`);
      missing.invalidProject = true;
      throw missing;
    }
    if (!(error instanceof SyntaxError)) throw error;
    const invalid = Error(`工程的 webgal-engine.json 不是有效的 JSON。请检查文件内容。\n位置：${filename}`);
    invalid.invalidProject = true;
    throw invalid;
  }
  if (!engine || typeof engine.id !== 'string' || !engine.id.trim()) {
    const invalid = Error('工程缺少有效的引擎 ID');
    invalid.invalidProject = true;
    throw invalid;
  }
  return { id: root, name: path.basename(root), gameRoot: path.join(root, 'game'), engineId: engine.id };
}
async function checkPath(root, entry) {
  try {
    if (typeof entry.path !== 'string' || !entry.path || path.isAbsolute(entry.path) || /^[a-z]:/i.test(entry.path) ||
      entry.path.replaceAll('\\', '/').split('/').some(part => part === '..')) throw Error('检测路径必须位于 game 目录内');
    const candidate = path.resolve(root, entry.path);
    if (!inside(root, candidate)) throw Error('检测路径超出 game 目录');
    const real = await fs.realpath(candidate);
    if (!inside(root, real)) throw Error('检测路径超出 game 目录');
    const info = await fs.stat(real);
    if (info.isFile()) return { installed: !entry.directoryOnly };
    if (!info.isDirectory()) return { installed: false };
    // 只读取首个目录条目，避免为了判断非空而遍历大型资源目录。
    const directory = await fs.opendir(real);
    try { return { installed: (await directory.read()) !== null }; }
    finally { await directory.close(); }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { installed: false };
    return { installed: false, error: userError(error).message };
  }
}
async function checkInstalledAt(root, entries) {
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.path !== 'string')) throw Error('无效检测列表');
  const results = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(16, entries.length) }, async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      results[entry.path] = await checkPath(root, entry);
    }
  }));
  return results;
}
async function checkInstalled(gamesRoot, id, entries) {
  return checkInstalledAt(await gameRoot(gamesRoot, id), entries);
}
module.exports = { listProjects, readProject, checkInstalled, checkInstalledAt };
