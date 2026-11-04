const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { crc32 } = require('node:zlib');
const { modelInstallRoot } = require('./model-path.cjs');
const { userError } = require('./user-error.cjs');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
async function safeParent(root, relative, fixedRoot = false) {
  let current = root;
  for (const part of relative.split('/')) {
    const next = path.join(current, part);
    await fs.mkdir(next).catch(error => { if (error.code !== 'EEXIST') throw error; });
    current = await fs.realpath(next);
    if (!inside(root, current)) throw Error('安装目录超出工程范围');
    if (fixedRoot && path.relative(next, current) !== '') throw Error('模型安装根目录不能指向其他目录');
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
      if (/[\\:<>"|?*\x00-\x1f]/.test(name) ||
        name.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(part))) {
        throw Error('ZIP 文件路径超出模型目录或含有非法路径');
      }
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw Error('模型包不能包含符号链接');
      const output = path.resolve(destination, name);
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
  const root = await fs.realpath(gameRoot);
  const figureRoot = await safeParent(root, modelInstallRoot, true);
  const temporary = await fs.mkdtemp(path.join(figureRoot, '.package-install-'));
  const staged = path.join(temporary, 'model');
  const backup = path.join(temporary, 'previous');
  const undo = [];
  let recovered = true;
  async function merge(source, destination) {
    if (path.relative(destination, await fs.realpath(destination)) !== '') throw Error('安装目录指向其他位置');
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const input = path.join(source, entry.name);
      const output = path.join(destination, entry.name);
      const stat = await fs.lstat(output).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (stat) {
        if (entry.isDirectory() && stat.isDirectory() && !stat.isSymbolicLink()) {
          await merge(input, output);
          continue;
        }
        if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink()) throw Error('安装目标与现有文件冲突');
        if (!overwrite) throw Error('模型已安装，请确认重新下载');
        const saved = path.join(backup, path.relative(figureRoot, output));
        await fs.mkdir(path.dirname(saved), { recursive: true });
        await fs.rename(output, saved);
        undo.push(() => fs.rename(saved, output));
      }
      await fs.rename(input, output);
      undo.push(() => fs.rename(output, input));
    }
  }
  try {
    const archive = path.join(temporary, 'download.zip');
    const { received } = await downloadArchive(model.url, archive, model, progress);
    progress({ state: 'extracting', received, total: model.bytes });
    await fs.mkdir(staged);
    await extractFiles(archive, staged, { expectedBytes: model.unpackedBytes });
    await merge(staged, figureRoot);
  } catch (error) {
    try { for (const rollback of undo.reverse()) await rollback(); }
    catch (restoreError) {
      recovered = false;
      throw Error(`${error.message}；恢复失败，请保留 ${temporary}：${restoreError.message}`);
    }
    throw error;
  } finally {
    // 临时目录由本次安装创建；恢复失败时保留旧模型，便于人工恢复。
    if (recovered) await fs.rm(temporary, { recursive: true, force: true });
  }
  progress({ state: 'installed', received: model.bytes, total: model.bytes });
}
module.exports = { installModel, extractFiles, downloadArchive, safeParent, inside };
