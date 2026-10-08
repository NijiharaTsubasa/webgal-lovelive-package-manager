const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readCatalogConfig, httpUrl } = require('../electron/catalog-config.cjs');
const { fetchCatalog, parseCatalog } = require('../electron/catalog-reader.cjs');
const { createServer } = require('node:http');
const { userError } = require('../electron/user-error.cjs');
const { appDirectory } = require('../electron/app-directory.cjs');

test('portable application uses the outer executable directory for configuration and games', () => {
  const packaged = { isPackaged: true, getAppPath: () => '/temporary/resources/app.asar' };
  assert.equal(appDirectory(packaged, { PORTABLE_EXECUTABLE_DIR: 'F:\\Terre' }, 'C:\\temporary\\app.exe'), 'F:\\Terre');
  assert.equal(appDirectory(packaged, {}, path.join(os.tmpdir(), 'app.exe')), os.tmpdir());
  assert.equal(appDirectory({ ...packaged, isPackaged: false, getAppPath: () => 'project' }, { PORTABLE_EXECUTABLE_DIR: 'ignored' }), 'project');
});

test('reads catalog URLs from configuration and reports missing or invalid fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-config-'));
  const filename = path.join(root, 'package-manager.config.json');
  try {
    await assert.rejects(readCatalogConfig(root), /找不到下载源配置文件：[\s\S]*package-manager.config.json/);
    const config = { modelCatalogUrl: 'https://host/models/catalog.json', resourceCatalogUrl: 'http://localhost:5191/resources.json' };
    await fs.writeFile(filename, JSON.stringify(config));
    assert.deepEqual(await readCatalogConfig(root), config);
    await fs.writeFile(filename, JSON.stringify({ ...config, modelCatalogUrl: 'file:///local.json' }));
    await assert.rejects(readCatalogConfig(root), /modelCatalogUrl.*HTTP/);
    await fs.writeFile(filename, JSON.stringify({ modelCatalogUrl: config.modelCatalogUrl }));
    await assert.rejects(readCatalogConfig(root), /resourceCatalogUrl/);
    await fs.writeFile(filename, '{');
    await assert.rejects(readCatalogConfig(root), /不是有效的 JSON/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('resolves resource URLs relative to catalog location and accepts separate download hosts', () => {
  assert.equal(httpUrl('model.zip', 'https://host/packages/models.json'), 'https://host/packages/model.zip');
  assert.equal(httpUrl('/preview.webp', 'https://host/packages/models.json'), 'https://host/preview.webp');
  assert.equal(httpUrl('https://cdn.example/model.zip', 'https://host/models.json'), 'https://cdn.example/model.zip');
  assert.throws(() => httpUrl('file:///local.zip', 'https://host/models.json'), /HTTP/);
});

test('catalog validation identifies broken entry and field without raw runtime errors', () => {
  const base = 'https://host/packages/resources.json';
  const item = { type: 'bgm', name: '音乐', description: '', installPath: 'bgm', checkPath: 'bgm/test', url: 'test.zip' };
  assert.equal(parseCatalog([item], base, 'resource').values().next().value.url, 'https://host/packages/test.zip');
  for (const [catalog, pattern] of [
    [{}, /最外层必须是数组/], [[null], /第 1 项.*资源对象/],
    [[{ ...item, name: null }], /第 1 项.*name/],
    [[{ ...item, type: 'toString' }], /type/],
    [[{ ...item, checkPath: 'bgm/../figure' }], /checkPath/],
    [[{ ...item, url: 'http://[' }], /url 地址无效/],
    [[{ ...item, url: '' }], /url 地址无效/],
    [[{ ...item, url: 'file:///x' }], /url 地址无效/],
    [[{ ...item, preview: 42 }], /preview/],
    [[{ ...item, preview: 'ftp://host/a.webp' }], /preview 地址无效/],
    [[{ ...item, bytes: -1 }], /bytes/],
    [[item, item], /第 2 项.*重复/],
  ]) assert.throws(() => parseCatalog(catalog, base, 'resource'), pattern);
  const model = { path: '莲之空/花帆/model', name: 'model', description: '', installPath: '3d/figure/莲之空/花帆/model',
    bytes: 100, unpackedBytes: 200, sha256: 'a'.repeat(64), url: 'model.zip' };
  assert.equal(parseCatalog([model], base, 'model').size, 1);
  for (const [field, value] of [['path', null], ['installPath', 'wrong'], ['bytes', 0], ['unpackedBytes', '200'], ['sha256', 'bad']]) {
    assert.throws(() => parseCatalog([{ ...model, [field]: value }], base, 'model'), new RegExp(`第 1 项.*${field}`));
  }
});

test('catalog HTTP missing, malformed and inaccessible sources fail clearly and recover', async () => {
  let mode = 'missing';
  const server = createServer((req, res) => {
    if (mode === 'missing') res.writeHead(404).end();
    else res.end(mode === 'invalid' ? '{' : '[]');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/models.json`;
  try {
    await assert.rejects(fetchCatalog(url, '模型清单'), /模型清单.*HTTP 404/);
    mode = 'invalid';
    await assert.rejects(fetchCatalog(url, '模型清单'), /有效的 JSON/);
    mode = 'valid';
    assert.deepEqual((await fetchCatalog(url, '模型清单')).catalog, []);
    await assert.rejects(fetchCatalog('http://127.0.0.1:1/models.json', '模型清单'), /无法连接下载源/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('filesystem error hints preserve useful location and existing application errors', () => {
  for (const [code, hint] of [['ENOENT', '不存在'], ['EACCES', '权限'], ['EBUSY', '其他程序'], ['ENOSPC', '空间不足']]) {
    assert.match(userError(Object.assign(Error('raw'), { code, path: 'test/path' })).message, new RegExp(`${hint}[\\s\\S]*test/path`));
  }
  const applicationError = Error('下载完整性校验失败');
  assert.equal(userError(applicationError), applicationError);
});
