const fs = require('node:fs/promises');
const path = require('node:path');
const { readProject } = require('./projects.cjs');
const { userError } = require('./user-error.cjs');

const engineId = 'webgal-lovelive.lovelive';
const replacements = ['assets', 'index.html', 'game/3d/runtime', 'webgal-engine.json'];
const llasThemeName = 'LoveLive! All Stars Theme';

async function themeUpgrade(applicationDirectory, projectRoot) {
  let current;
  try { current = JSON.parse((await fs.readFile(path.join(projectRoot, 'game/template/template.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (current?.name !== llasThemeName) return {};
  const directory = path.join(applicationDirectory, 'data/templates');
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(directory, entry.name);
    let config;
    try { config = JSON.parse((await fs.readFile(path.join(root, 'template.json'), 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
    if (config?.name === current.name) matches.push(root);
  }
  if (matches.length === 1) return { root: matches[0] };
  return { themeNotice: matches.length > 1
    ? '一键包中存在多个 LLAS 主题，当前主题已保留，请在 Terre 中手动应用最新的 LLAS 主题。'
    : '一键包中未找到 LLAS 主题，当前主题已保留，请在 Terre 中手动应用 LLAS 主题。' };
}

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') ?? [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw Error('无法识别引擎版本号，请检查 webgal-engine.json 中的 version。');
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length) return Number(!left.pre.length) - Number(!right.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const x = left.pre[i], y = right.pre[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
async function readEngine(root) {
  return JSON.parse((await fs.readFile(path.join(root, 'webgal-engine.json'), 'utf8')).replace(/^\uFEFF/, ''));
}
async function latestEngine(applicationDirectory) {
  const directory = path.join(applicationDirectory, 'data', 'derivative-engines');
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let latest = null;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const root = path.join(directory, entry.name);
    let engine;
    try { engine = await readEngine(root); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
    if (engine?.id !== engineId || !parseVersion(engine.version)) continue;
    if (!latest || compareVersions(engine.version, latest.version) > 0) latest = { root, version: engine.version };
  }
  return latest;
}
async function engineUpgradeStatus(applicationDirectory, projectRoot) {
  const project = await readProject(projectRoot);
  if (project.engineId !== engineId) return null;
  const engine = await readEngine(project.id);
  const latest = await latestEngine(applicationDirectory);
  if (!latest) return null;
  const { themeNotice } = await themeUpgrade(applicationDirectory, project.id);
  return { currentVersion: engine.version, latestVersion: latest.version,
    available: compareVersions(engine.version, latest.version) < 0, ...(themeNotice ? { themeNotice } : {}) };
}
function overlaps(a, b) {
  const inside = (root, target) => {
    const relative = path.relative(root, target);
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
  };
  return inside(a, b) || inside(b, a);
}
async function ordinaryPath(root, relative, createParents = false) {
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (createParents && i < parts.length - 1) await fs.mkdir(current);
      continue;
    }
    if (stat.isSymbolicLink()) throw Error(`升级路径不能包含符号链接：${current}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw Error(`升级路径不是目录：${current}`);
  }
  return current;
}
async function upgradeEngine(applicationDirectory, projectRoot, operations = fs) {
  const project = await readProject(projectRoot);
  if (project.engineId !== engineId) throw Error('当前工程不是 LoveLive 引擎，无法升级。');
  const current = await readEngine(project.id);
  const latest = await latestEngine(applicationDirectory);
  if (!latest || compareVersions(current.version, latest.version) >= 0) return project;
  const source = await fs.realpath(latest.root), target = await fs.realpath(project.id);
  if (overlaps(source, target)) throw Error('工程与附带引擎目录不能重叠。');
  const theme = await themeUpgrade(applicationDirectory, target);
  const plan = replacements.map(relative => ({ relative, root: source, sourceRelative: relative,
    directory: relative === 'assets' || relative === 'game/3d/runtime' }));
  if (theme.root) {
    const themeRoot = await fs.realpath(theme.root);
    if (overlaps(themeRoot, target)) throw Error('工程与附带主题目录不能重叠。');
    plan.splice(plan.length - 1, 0, { relative: 'game/template', root: themeRoot, sourceRelative: '.', directory: true });
  }
  // 先检查完整来源；缺失资源时不改动工程。
  for (const { relative, root, sourceRelative, directory } of plan) {
    const filename = await ordinaryPath(root, sourceRelative);
    const stat = await fs.stat(filename);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error(`附带引擎文件类型不正确：${filename}`);
    await ordinaryPath(target, relative);
  }
  const temporary = await fs.mkdtemp(path.join(target, '.engine-upgrade-'));
  const staged = path.join(temporary, 'staged'), previous = path.join(temporary, 'previous');
  const changed = [];
  let keepPrevious = false;
  try {
    for (const { relative, root, sourceRelative } of plan) {
      const filename = path.join(staged, relative);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await operations.cp(path.join(root, sourceRelative), filename, { recursive: true, filter: async file => {
        if ((await fs.lstat(file)).isSymbolicLink()) throw Error(`附带引擎不能包含符号链接：${file}`);
        return true;
      } });
    }
    for (const { relative } of plan) {
      const filename = await ordinaryPath(target, relative, true);
      const backup = path.join(previous, relative);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      const change = { filename, backup, moved: false, installed: false };
      changed.push(change);
      try { await operations.rename(filename, backup); change.moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await operations.rename(path.join(staged, relative), filename);
      change.installed = true;
    }
    return { ...await readProject(target), ...(theme.themeNotice ? { themeNotice: theme.themeNotice } : {}) };
  } catch (error) {
    const failures = [];
    for (const change of changed.reverse()) {
      try {
        if (change.installed) await fs.rm(change.filename, { recursive: true, force: true });
        if (change.moved) await fs.rename(change.backup, change.filename);
      } catch (restoreError) { failures.push(userError(restoreError).message); }
    }
    keepPrevious = failures.length > 0;
    throw Error(`引擎升级失败：${userError(error).message}${keepPrevious
      ? `\n部分文件未能恢复，原文件保存在：${previous}\n${failures.join('\n')}` : '\n工程原文件已保留。'}`);
  } finally {
    if (!keepPrevious) await fs.rm(temporary, { recursive: true, force: true });
  }
}
module.exports = { compareVersions, latestEngine, engineUpgradeStatus, upgradeEngine };
