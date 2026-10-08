const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { findGamesRoot, listProjects, readProject, checkInstalled } = require('../electron/projects.cjs');

test('prefers data/games and falls back to public/games only when absent', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-roots-'));
  try {
    const portable = path.join(temporary, 'data', 'games');
    const legacy = path.join(temporary, 'public', 'games');
    assert.equal(await findGamesRoot(temporary), legacy);
    assert.deepEqual((await listProjects(await findGamesRoot(temporary))).projects, []);
    await fs.mkdir(legacy, { recursive: true });
    assert.equal(await findGamesRoot(temporary), legacy);
    await fs.mkdir(portable, { recursive: true });
    assert.equal(await findGamesRoot(temporary), portable);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('discovers immediate projects and checks only existence or nonempty directory', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'package-manager-projects-'));
  try {
    const games = path.join(temporary, 'games');
    const game = path.join(games, '工程甲', 'game');
    await fs.mkdir(path.join(game, 'empty'), { recursive: true });
    await fs.mkdir(path.join(game, 'present'), { recursive: true });
    await fs.mkdir(path.join(games, '工程乙', 'game'), { recursive: true });
    await fs.mkdir(path.join(games, '不是工程'), { recursive: true });
    await fs.writeFile(path.join(games, '工程甲', 'webgal-engine.json'), JSON.stringify({ id: 'webgal-lovelive.lovelive' }));
    await fs.writeFile(path.join(games, '工程乙', 'webgal-engine.json'), JSON.stringify({ id: 'webgal.mygo' }));
    await fs.writeFile(path.join(game, 'present', 'arbitrary.txt'), '');
    await fs.writeFile(path.join(game, 'file.bin'), '');
    assert.deepEqual((await listProjects(games)).projects.map(item => item.name), ['工程甲', '工程乙']);
    assert.deepEqual(await readProject(game), await readProject(path.dirname(game)));
    assert.equal((await readProject(path.join(games, '工程乙'))).engineId, 'webgal.mygo');
    await assert.rejects(readProject(path.join(games, '不是工程')));
    await assert.rejects(readProject(path.join(games, '不是工程')), /缺少 webgal-engine.json/);
    await fs.writeFile(path.join(games, '不是工程', 'webgal-engine.json'), '{');
    await assert.rejects(readProject(path.join(games, '不是工程')), /不是有效的 JSON/);
    await fs.writeFile(path.join(games, '不是工程', 'webgal-engine.json'), 'null');
    await assert.rejects(readProject(path.join(games, '不是工程')), /有效的引擎 ID/);
    assert.equal((await listProjects(games)).projects.length, 2);
    const result = await checkInstalled(games, '工程甲', [
      ...['empty', 'present', 'missing', 'file.bin', 'file.bin/nested', '../escape'].map(value => ({ path: value, directoryOnly: false })),
    ]);
    assert.equal(result.empty.installed, false);
    assert.equal(result.present.installed, true);
    assert.equal(result.missing.installed, false);
    assert.equal(result['file.bin'].installed, true);
    assert.equal(result['file.bin/nested'].installed, false);
    assert.ok(result['../escape'].error);
    assert.equal((await checkInstalled(games, '工程甲', [{ path: 'file.bin', directoryOnly: true }]))['file.bin'].installed, false);
    assert.equal((await checkInstalled(games, '工程乙', [{ path: 'present' }])).present.installed, false);
    await assert.rejects(checkInstalled(games, '../工程甲', []));
    assert.deepEqual((await listProjects(path.join(temporary, 'absent'))).projects, []);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
