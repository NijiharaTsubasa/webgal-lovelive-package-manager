const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
const { createPacked, createZip } = require('./fixtures.cjs');
const { createPackageServer } = require('./package-server.cjs');
const { installModel, extractArchive, downloadArchive } = require('../electron/model-installer.cjs');
const { installResource } = require('../electron/resource-installer.cjs');
const { checkInstalledAt } = require('../electron/projects.cjs');

test('band and monthly model paths install into their final package directory', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-band-'));
  let server;
  try {
    const packed = path.join(temporary, 'packed'), game = path.join(temporary, 'game');
    await fs.mkdir(game);
    const models = [
      { name: '001_cos_live_default', description: '', path: "BanG Dream/01Poppin'Party/01户山香澄/001_cos_live_default" },
      { name: '036_cos_live_default', description: '', path: 'BanG Dream/08MyGO!!!!!/36高松灯/036_cos_live_default' },
      { name: '000_cos_monthly', description: '', path: 'BanG Dream/00月度服装/000_cos_monthly' },
    ];
    const catalog = await createPacked(packed, models, Buffer.from('image'));
    server = await createPackageServer(packed);
    for (const entry of catalog) {
      entry.url = new URL(entry.url, server.origin).href;
      await installModel(game, entry, false);
      assert.equal(await fs.readFile(path.join(game, entry.installPath, 'model.glb'), 'utf8'), 'test-model-content');
      const status = await checkInstalledAt(game, [{ path: entry.installPath, directoryOnly: true }]);
      assert.equal(status[entry.installPath].installed, true);
      await assert.rejects(installModel(game, entry, false), /请确认/);
      await installModel(game, entry, true);
    }
  } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test('resource download preserves sibling files and requires confirmed replacement', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-resource-'));
  let server;
  try {
    await fs.mkdir(path.join(temporary, 'others'));
    await fs.mkdir(path.join(temporary, 'game'));
    await createZip(path.join(temporary, 'others', 'motions.zip'), [['hasunosora/test.motionbin', 'motion']]);
    server = await createPackageServer(path.join(temporary, 'packed'));
    const entry = { type: 'motion', checkPath: '3d/motion/hasunosora', url: `${server.origin}others/motions.zip` };
    const game = path.join(temporary, 'game');
    await installResource(game, entry, false);
    const file = path.join(game, entry.checkPath, 'test.motionbin');
    assert.equal(await fs.readFile(file, 'utf8'), 'motion');
    const sibling = path.join(game, entry.checkPath, 'keep.txt');
    await fs.writeFile(sibling, 'keep');
    await assert.rejects(installResource(game, entry, false), /确认/);
    await assert.rejects(installResource(game, { ...entry, url: `${server.origin}others/missing.zip` }, true), /404/);
    assert.equal(await fs.readFile(file, 'utf8'), 'motion');
    await installResource(game, entry, true);
    assert.equal(await fs.readFile(sibling, 'utf8'), 'keep');
  } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test('real HTTP catalog, download, verification, extraction and confirmed replacement', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-download-'));
  let server;
  try {
    const packed = path.join(temporary, 'packed'), game = path.join(temporary, 'game');
    await fs.mkdir(game);
    const model = { name: 'model', description: '冬服', path: '虹咲/09璃奈/model' };
    await createPacked(packed, [model], Buffer.from('webp-fixture'));
    server = await createPackageServer(packed);
    const response = await fetch(`${server.origin}models.json`);
    assert.equal(response.status, 200);
    const [entry] = await response.json();
    entry.url = new URL(entry.url, server.origin).href;
    assert.equal(entry.description, '冬服');
    const states = [];
    await installModel(game, entry, false, update => states.push(update.state));
    assert.equal(await fs.readFile(path.join(game, entry.installPath, 'model.glb'), 'utf8'), 'test-model-content');
    assert.ok(states.includes('downloading')); assert.ok(states.includes('extracting')); assert.equal(states.at(-1), 'installed');
    await assert.rejects(installModel(game, entry, false), /请确认/);
    await fs.writeFile(path.join(game, entry.installPath, 'model.glb'), 'old-content');
    await assert.rejects(installModel(game, { ...entry, sha256: '0'.repeat(64) }, true), /完整性/);
    assert.equal(await fs.readFile(path.join(game, entry.installPath, 'model.glb'), 'utf8'), 'old-content');
    await assert.rejects(installModel(game, { ...entry, url: `${server.origin}missing.zip` }, true), /HTTP 404/);
    await assert.rejects(installModel(game, { ...entry, unpackedBytes: 1 }, true), /解压大小/);
    assert.equal(await fs.readFile(path.join(game, entry.installPath, 'model.glb'), 'utf8'), 'old-content');
    await installModel(game, entry, true);
    assert.equal(await fs.readFile(path.join(game, entry.installPath, 'model.glb'), 'utf8'), 'test-model-content');
    assert.deepEqual((await fs.readdir(path.dirname(path.join(game, entry.installPath)))).filter(name => name.startsWith('.package-install-')), []);
    assert.equal((await fetch(`${server.origin}%2e%2e%2fsecret.zip`)).status, 404);
    const malicious = path.join(temporary, 'wrong.zip'), destination = path.join(temporary, 'extract');
    await fs.mkdir(destination);
    await createZip(malicious, [['somewhere/else.txt', 'bad']]);
    await assert.rejects(extractArchive(malicious, destination, entry), /超出模型目录/);
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    const linkedGame = path.join(temporary, 'linked-game');
    await fs.mkdir(linkedGame);
    await fs.symlink(outside, path.join(linkedGame, '3d'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(installModel(linkedGame, entry, false), /超出工程范围/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test('invalid addresses, broken ZIP and missing package contents preserve installed resources', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-errors-'));
  let server;
  try {
    const game = path.join(temporary, 'game'), others = path.join(temporary, 'others');
    await fs.mkdir(path.join(game, 'bgm/test'), { recursive: true });
    await fs.mkdir(others);
    const existing = path.join(game, 'bgm/test/old.txt');
    await fs.writeFile(existing, 'keep');
    await fs.writeFile(path.join(others, 'broken.zip'), 'not a zip');
    await createZip(path.join(others, 'missing.zip'), [['different/file.txt', 'content']]);
    server = await createPackageServer(path.join(temporary, 'packed'));
    for (const url of ['file:///x', 'http://[']) {
      await assert.rejects(downloadArchive(url, path.join(temporary, 'download.zip')), /下载地址无效/);
    }
    await assert.rejects(downloadArchive('http://127.0.0.1:1/a.zip', path.join(temporary, 'download.zip')), /无法连接下载地址/);
    const entry = { type: 'bgm', checkPath: 'bgm/test', url: `${server.origin}others/broken.zip` };
    await assert.rejects(installResource(game, entry, true), /有效的 ZIP/);
    await assert.rejects(installResource(game, { ...entry, url: `${server.origin}others/missing.zip` }, true), /资源包缺少.*bgm\/test/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep');
    assert.deepEqual((await fs.readdir(path.join(game, 'bgm'))).filter(name => name.startsWith('.package-install-')), []);
    const modelZip = path.join(temporary, 'model.zip'), extract = path.join(temporary, 'extract');
    await createZip(modelZip, [['group/person/model/model.glb', 'data']]);
    await fs.mkdir(extract);
    await assert.rejects(extractArchive(modelZip, extract, { path: 'group/person/model', unpackedBytes: 4 }), /模型包缺少 config.json/);
  } finally { await server?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test('interrupted HTTP download reports a recoverable transfer failure', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-interrupted-'));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 100 });
    res.write('partial');
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(downloadArchive(`http://127.0.0.1:${server.address().port}/model.zip`, path.join(temporary, 'download.zip')), /传输中断或超时/);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(temporary, { recursive: true, force: true }); }
});
