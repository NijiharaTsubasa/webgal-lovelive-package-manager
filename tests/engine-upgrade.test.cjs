const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { compareVersions, latestEngine, engineUpgradeStatus, upgradeEngine } = require('../electron/engine-upgrade.cjs');

async function engine(root, version, id = 'webgal-lovelive.lovelive', content = 'new') {
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.mkdir(path.join(root, 'game/3d/runtime'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets', `${content}.js`), content);
  await fs.writeFile(path.join(root, 'index.html'), content);
  await fs.writeFile(path.join(root, 'game/3d/runtime', `${content}.js`), content);
  await fs.writeFile(path.join(root, 'webgal-engine.json'), JSON.stringify({ id, version, webgalVersion: '4.6.4' }));
}
async function setup(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'package-engine-'));
  try { await run(root, path.join(root, 'data/derivative-engines'), path.join(root, 'games/project')); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function theme(root, name = 'LoveLive! All Stars Theme', content = 'new') {
  await fs.mkdir(path.join(root, 'UI'), { recursive: true });
  await fs.writeFile(path.join(root, 'template.json'), JSON.stringify({ name }));
  await fs.writeFile(path.join(root, 'UI', `${content}.scss`), content);
}

test('LLAS theme matches JSON name and replaces complete template directory', async () => setup(async (root, engines, project) => {
  await engine(path.join(engines, 'latest'), '0.2.0');
  await engine(project, '0.1.0');
  await theme(path.join(project, 'game/template'), undefined, 'old');
  await theme(path.join(root, 'data/templates/arbitrary-folder'));
  await theme(path.join(root, 'data/templates/LoveLive! All Stars Theme'), 'Other theme');
  const result = await upgradeEngine(root, project);
  assert.equal(result.themeNotice, undefined);
  assert.deepEqual(await fs.readdir(path.join(project, 'game/template/UI')), ['new.scss']);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, 'game/template/template.json'), 'utf8')).name, 'LoveLive! All Stars Theme');
}));

test('multiple LLAS templates keep current theme and report manual application before and after upgrade', async () => setup(async (root, engines, project) => {
  await engine(path.join(engines, 'latest'), '0.2.0');
  await engine(project, '0.1.0');
  await theme(path.join(project, 'game/template'), undefined, 'old');
  await theme(path.join(root, 'data/templates/one'));
  await theme(path.join(root, 'data/templates/two'));
  assert.match((await engineUpgradeStatus(root, project)).themeNotice, /多个 LLAS.*Terre.*手动应用/);
  const result = await upgradeEngine(root, project);
  assert.equal(result.engineVersion, '0.2.0');
  assert.match(result.themeNotice, /多个 LLAS.*Terre.*手动应用/);
  assert.deepEqual(await fs.readdir(path.join(project, 'game/template/UI')), ['old.scss']);
}));

test('other themes are preserved and failed upgrade restores LLAS template with engine files', async () => setup(async (root, engines, project) => {
  await engine(path.join(engines, 'latest'), '0.2.0');
  await engine(project, '0.1.0', undefined, 'old');
  await theme(path.join(project, 'game/template'), 'MyGO Theme', 'custom');
  await theme(path.join(root, 'data/templates/llas'));
  await upgradeEngine(root, project);
  assert.deepEqual(await fs.readdir(path.join(project, 'game/template/UI')), ['custom.scss']);
  await engine(project, '0.1.0', undefined, 'old');
  await theme(path.join(project, 'game/template'), undefined, 'old');
  const operations = { ...fs, rename: async (from, to) => {
    if (from.includes(`${path.sep}staged${path.sep}`) && to === path.join(project, 'webgal-engine.json')) throw Error('test interruption');
    return fs.rename(from, to);
  } };
  await assert.rejects(upgradeEngine(root, project, operations), /升级失败/);
  assert.deepEqual(await fs.readdir(path.join(project, 'game/template/UI')), ['custom.scss', 'old.scss']);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, 'game/template/template.json'), 'utf8')).name, 'LoveLive! All Stars Theme');
  assert.equal(JSON.parse(await fs.readFile(path.join(project, 'webgal-engine.json'), 'utf8')).version, '0.1.0');
}));

test('engine versions compare numeric components, prereleases and build metadata', () => {
  const ordered = ['0.1.0-beta.1', '0.1.0-beta.2', '0.1.0-beta.10', '0.1.0', '0.2.0', '0.10.0', '1.0.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
  assert.equal(compareVersions('0.2.0+one', '0.2.0+two'), 0);
  assert.equal(compareVersions('0.2.0-alpha.1', '0.2.0-alpha.a'), -1);
  assert.throws(() => compareVersions(undefined, '0.2.0'), /无法识别/);
});

test('discovers latest LoveLive version from metadata and only offers newer engines', async () => setup(async (root, engines, project) => {
  await engine(project, '0.1.0');
  assert.equal(await engineUpgradeStatus(root, project), null);
  await engine(path.join(engines, 'new-name-irrelevant'), '0.10.0');
  await engine(path.join(engines, 'LoveLive-999'), '0.2.0');
  await engine(path.join(engines, 'MyGO'), '99.0.0', 'webgal-mygo.mygo');
  await engine(path.join(engines, 'invalid-version'), 'broken');
  await fs.mkdir(path.join(engines, 'incomplete'));
  await fs.writeFile(path.join(engines, 'incomplete/webgal-engine.json'), '{');
  await fs.mkdir(path.join(engines, 'empty-metadata'));
  await fs.writeFile(path.join(engines, 'empty-metadata/webgal-engine.json'), 'null');
  assert.equal((await latestEngine(root)).version, '0.10.0');
  assert.deepEqual(await engineUpgradeStatus(root, project), { currentVersion: '0.1.0', latestVersion: '0.10.0', available: true });
  await engine(project, '0.10.0');
  assert.equal((await engineUpgradeStatus(root, project)).available, false);
  await engine(project, '0.11.0');
  assert.equal((await engineUpgradeStatus(root, project)).available, false);
  await engine(project, '0.1.0', 'webgal-mygo.mygo');
  assert.equal(await engineUpgradeStatus(root, project), null);
  await assert.rejects(upgradeEngine(root, project), /不是 LoveLive/);
}));

test('engine upgrade replaces complete directories and version file, preserving project content', async () => setup(async (root, engines, project) => {
  const source = path.join(engines, 'latest');
  await engine(source, '0.2.0');
  await engine(project, '0.1.0', undefined, 'old');
  for (const relative of ['game/scene/start.txt', 'game/3d/figure/model/config.json', 'game/3d/motion/test.motionbin', 'game/config.txt', 'manifest.json']) {
    await fs.mkdir(path.dirname(path.join(project, relative)), { recursive: true });
    await fs.writeFile(path.join(project, relative), 'keep');
  }
  const result = await upgradeEngine(root, project);
  assert.equal(result.engineVersion, '0.2.0');
  assert.deepEqual(await fs.readdir(path.join(project, 'assets')), ['new.js']);
  assert.deepEqual(await fs.readdir(path.join(project, 'game/3d/runtime')), ['new.js']);
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), 'new');
  assert.deepEqual(await fs.readFile(path.join(project, 'webgal-engine.json')), await fs.readFile(path.join(source, 'webgal-engine.json')));
  for (const relative of ['game/scene/start.txt', 'game/3d/figure/model/config.json', 'game/3d/motion/test.motionbin', 'game/config.txt', 'manifest.json']) {
    assert.equal(await fs.readFile(path.join(project, relative), 'utf8'), 'keep');
  }
  assert.equal((await engineUpgradeStatus(root, project)).available, false);
  assert.equal((await fs.readdir(project)).some(name => name.startsWith('.engine-upgrade-')), false);
  assert.equal((await upgradeEngine(root, project)).engineVersion, '0.2.0');
}));

test('missing source fails before replacement, and interrupted replacement restores previous files', async () => setup(async (root, engines, project) => {
  const source = path.join(engines, 'latest');
  await engine(source, '0.2.0');
  await engine(project, '0.1.0', undefined, 'old');
  await fs.unlink(path.join(source, 'index.html'));
  await assert.rejects(upgradeEngine(root, project), /ENOENT/);
  assert.equal(await fs.readFile(path.join(project, 'assets/old.js'), 'utf8'), 'old');
  await fs.writeFile(path.join(source, 'index.html'), 'new');
  for (const failedFile of ['index.html', 'webgal-engine.json']) {
    const operations = { ...fs, rename: async (from, to) => {
      if (from.includes(`${path.sep}staged${path.sep}`) && to === path.join(project, failedFile)) {
        const error = Error('locked'); error.code = 'EBUSY'; throw error;
      }
      return fs.rename(from, to);
    } };
    await assert.rejects(upgradeEngine(root, project, operations), /升级失败.*文件正在被其他程序使用[\s\S]*原文件已保留/);
    assert.deepEqual(await fs.readdir(path.join(project, 'assets')), ['old.js']);
    assert.deepEqual(await fs.readdir(path.join(project, 'game/3d/runtime')), ['old.js']);
    assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), 'old');
    assert.equal(JSON.parse(await fs.readFile(path.join(project, 'webgal-engine.json'), 'utf8')).version, '0.1.0');
    assert.equal((await fs.readdir(project)).some(name => name.startsWith('.engine-upgrade-')), false);
  }
}));

test('upgrade refuses overlapping roots and linked destination parents', async () => setup(async (root, engines, project) => {
  const source = path.join(engines, 'latest');
  await engine(source, '0.2.0');
  await engine(project, '0.1.0', undefined, 'old');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.rm(path.join(project, 'game/3d'), { recursive: true });
  await fs.symlink(outside, path.join(project, 'game/3d'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(upgradeEngine(root, project), /符号链接/);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await fs.readFile(path.join(project, 'assets/old.js'), 'utf8'), 'old');
  const nested = path.join(source, 'nested-project');
  await engine(nested, '0.1.0');
  await assert.rejects(upgradeEngine(root, nested), /不能重叠/);
}));
