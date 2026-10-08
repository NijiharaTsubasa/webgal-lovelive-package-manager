const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { crc32 } = require('node:zlib');
const { modelPath } = require('./model-path.cjs');
const { userError } = require('./user-error.cjs');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
async function safeParent(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    await fs.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    current = await fs.realpath(current);
    if (!inside(root, current)) throw Error('安装目录超出工程范围');
  }
  return current;
}
async function extractFiles(filename, destination, options = {}, progress = () => {}) {
  let zip;
  try { zip = await yauzl.openPromise(filename, { lazyEntries: true, strictFileNames: true }); }
  catch (error) {
    if (userError(error) !== error) throw error;
    throw Error('下载包不是有效的 ZIP 文件，或文件已损坏。请重新下载；若仍失败，请联系下载源维护者。');
  }
  const seen = new Set();
  let unpackedBytes = 0, files = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if ((options.prefix && !name.startsWith(`${options.prefix}/`)) || /[\\:\x00-\x1f]/.test(name) ||
        name.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
        throw Error('ZIP 文件路径超出模型目录或含有非法路径');
      }
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw Error('模型包不能包含符号链接');
      const relative = options.prefix ? name.slice(options.prefix.length + 1) : name;
      if (!relative) continue;
      const output = path.resolve(destination, relative);
      if (!inside(destination, output)) throw Error('ZIP 文件路径超出模型目录');
      const key = output.toLowerCase();
      if (seen.has(key)) throw Error('ZIP 文件路径重复');
      seen.add(key);
      unpackedBytes += entry.uncompressedSize;
      if (options.expectedBytes !== undefined && unpackedBytes > options.expectedBytes) throw Error('解压大小超过清单声明');
      if (name.endsWith('/')) { await fs.mkdir(output, { recursive: true }); continue; }
      await fs.mkdir(path.dirname(output), { recursive: true });
      let checksum = 0;
      const meter = new Transform({ transform(chunk, encoding, callback) { checksum = crc32(chunk, checksum); callback(null, chunk); } });
      await pipeline(await zip.openReadStreamPromise(entry), meter, createWriteStream(output, { flags: 'wx' }));
      if (checksum !== entry.crc32) throw Error('ZIP 文件校验失败');
      progress({ files: ++files, totalFiles: zip.entryCount });
    }
  } catch (error) {
    if (userError(error) !== error || /[\u4e00-\u9fff]/.test(error.message)) throw error;
    throw Error('ZIP 解压失败：文件损坏或包含不支持的压缩内容。请重新下载；若仍失败，请联系下载源维护者。');
  } finally { zip.close(); }
  if (options.expectedBytes !== undefined && unpackedBytes !== options.expectedBytes) throw Error('解压大小与清单不一致');
}
async function extractArchive(filename, destination, model) {
  await extractFiles(filename, destination, { prefix: model.path, expectedBytes: model.unpackedBytes });
  try { await fs.access(path.join(destination, 'config.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw Error('模型包缺少 config.json，无法安装。请联系下载源维护者。');
  }
}
async function downloadArchive(url, filename, expected = {}, progress = () => {}) {
  let address;
  try {
    address = new URL(url);
    if (!['http:', 'https:'].includes(address.protocol)) throw Error();
  } catch { throw Error('下载地址无效，必须使用完整的 HTTP 或 HTTPS 地址。请联系下载源维护者。'); }
  let response;
  try { response = await fetch(address, { signal: AbortSignal.timeout(10 * 60 * 1000) }); }
  catch (error) {
    throw Error(error.name === 'TimeoutError' ? '下载超时，请检查网络后重新下载。' : '无法连接下载地址，请检查网络或稍后重新下载。');
  }
  if (!response.ok || !response.body) throw Error(`下载失败：HTTP ${response.status}`);
  const headerLength = Number(response.headers.get('content-length'));
  const total = expected.bytes ?? (Number.isSafeInteger(headerLength) && headerLength > 0 ? headerLength : 0);
  const hash = expected.sha256 ? createHash('sha256') : undefined;
  let received = 0, last = 0;
  progress({ state: 'downloading', received, total });
  const meter = new Transform({ transform(chunk, encoding, callback) {
    received += chunk.length; hash?.update(chunk);
    if (total && received > total) { callback(Error('下载大小超过声明')); return; }
    if (Date.now() - last > 100) { progress({ state: 'downloading', received, total }); last = Date.now(); }
    callback(null, chunk);
  } });
  try { await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(filename, { flags: 'wx' })); }
  catch (error) {
    if (userError(error) !== error) throw error;
    if (/[\u4e00-\u9fff]/.test(error.message)) throw error;
    throw Error('下载传输中断或超时，请检查网络后重新下载。');
  }
  if ((total && received !== total) || (hash && hash.digest('hex') !== expected.sha256)) throw Error('下载完整性校验失败');
  return { received, total: total || received };
}
async function installModel(gameRoot, model, overwrite, progress = () => {}) {
  modelPath(model.path);
  if (model.installPath !== `3d/figure/${model.path}`) throw Error('模型安装路径与清单不一致');
  const root = await fs.realpath(gameRoot);
  const parts = model.path.split('/');
  const parent = await safeParent(root, `3d/figure/${parts.slice(0, -1).join('/')}`);
  const target = path.join(parent, parts[2]);
  let exists = false;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('安装目标不是普通目录');
    exists = true;
    if (!overwrite && (await fs.readdir(target)).length) throw Error('模型已安装，请确认重新下载');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await fs.mkdtemp(path.join(parent, '.package-install-'));
  const staged = path.join(temporary, 'model');
  const backup = path.join(temporary, 'previous');
  let movedPrevious = false, installed = false;
  try {
    const archive = path.join(temporary, 'download.zip');
    const { received } = await downloadArchive(model.url, archive, model, progress);
    progress({ state: 'extracting', received, total: model.bytes });
    await fs.mkdir(staged);
    await extractArchive(archive, staged, model);
    // 下载期间目标可能被外部改动，提交前再次检查路径及覆盖权限。
    if (await fs.realpath(parent) !== parent) throw Error('安装目录在下载期间发生变化');
    try {
      const stat = await fs.lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('安装目标不是普通目录');
      exists = true;
      if (!overwrite && (await fs.readdir(target)).length) throw Error('模型已安装，请确认重新下载');
    } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    if (exists) { await fs.rename(target, backup); movedPrevious = true; }
    await fs.rename(staged, target);
    installed = true;
    progress({ state: 'installed', received, total: model.bytes });
  } catch (error) {
    if (movedPrevious && !installed) {
      try { await fs.rename(backup, target); movedPrevious = false; }
      catch (restoreError) { throw Error(`${error.message}；恢复旧模型失败，旧文件保存在 ${backup}：${restoreError.message}`); }
    }
    throw error;
  } finally {
    // 临时目录由本次安装创建；恢复失败时保留旧模型，便于人工恢复。
    if (!movedPrevious || installed) await fs.rm(temporary, { recursive: true, force: true });
  }
}
module.exports = { installModel, extractArchive, extractFiles, downloadArchive, safeParent, inside };
