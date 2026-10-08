const fs = require('node:fs/promises');
const path = require('node:path');
const { checkInstalledAt } = require('./projects.cjs');
const { extractFiles, downloadArchive, safeParent, inside } = require('./model-installer.cjs');

const roots = { motion: '3d/motion', live2d_mot_exp: '3d/mtn_exp', background: 'background', bgm: 'bgm', figure: 'figure' };
async function *filesIn(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield *filesIn(path.join(directory, entry.name), relative);
    else yield relative;
  }
}
async function installResource(gameRoot, resource, overwrite, progress = () => {}) {
  const directory = roots[resource.type];
  if (!directory || !resource.checkPath.startsWith(`${directory}/`)) throw Error('资源检测路径必须位于对应资源目录');
  const root = await fs.realpath(gameRoot);
  const status = (await checkInstalledAt(root, [{ path: resource.checkPath }]))[resource.checkPath];
  if (status.error) throw Error(status.error);
  if (status.installed && !overwrite) throw Error('资源已安装，请确认重新下载');
  const target = await safeParent(root, directory);
  const temporary = await fs.mkdtemp(path.join(target, '.package-install-'));
  const staged = path.join(temporary, 'content'), backup = path.join(temporary, 'previous');
  const written = [], previous = [];
  let recovered = true;
  try {
    const archive = path.join(temporary, 'download.zip');
    const bytes = await downloadArchive(resource.url, archive, resource, progress);
    progress({ state: 'extracting', ...bytes });
    await fs.mkdir(staged);
    let last = 0;
    await extractFiles(archive, staged, {}, update => {
      if (Date.now() - last > 100) { progress({ state: 'extracting', ...bytes, ...update }); last = Date.now(); }
    });
    const check = path.resolve(staged, resource.checkPath.slice(directory.length + 1));
    if (!inside(staged, check)) throw Error('资源检测路径超出安装目录');
    try { await fs.access(check); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw Error(`资源包缺少清单指定的文件或目录：${resource.checkPath}。请联系下载源维护者。`);
    }
    const current = (await checkInstalledAt(root, [{ path: resource.checkPath }]))[resource.checkPath];
    if (current.error) throw Error(current.error);
    if (current.installed && !overwrite) throw Error('资源已安装，请确认重新下载');
    if (await fs.realpath(target) !== target) throw Error('安装目录在下载期间发生变化');
    progress({ state: 'installing', ...bytes });
    for await (const relative of filesIn(staged)) {
      const parentPart = path.posix.dirname(relative);
      const parent = parentPart === '.' ? target : await safeParent(target, parentPart);
      const output = path.join(parent, path.posix.basename(relative));
      try {
        const stat = await fs.lstat(output);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('安装目标不是普通文件');
        if (!overwrite) throw Error('资源文件已存在，请确认重新下载');
        const saved = path.join(backup, relative);
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.rename(output, saved);
        previous.push({ output, saved });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(path.join(staged, relative), output);
      written.push(output);
    }
    progress({ state: 'installed', ...bytes });
  } catch (error) {
    try {
      for (const output of written.reverse()) await fs.unlink(output);
      for (const item of previous.reverse()) await fs.rename(item.saved, item.output);
    } catch (restoreError) {
      recovered = false;
      throw Error(`${error.message}；恢复失败，请保留 ${temporary}：${restoreError.message}`);
    }
    throw error;
  } finally { if (recovered) await fs.rm(temporary, { recursive: true, force: true }); }
}
module.exports = { installResource, roots };
