import { test, expect, chromium } from '@playwright/test';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { stat, mkdir, writeFile, readFile, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fixtures from '../fixtures.cjs';
import packageServer from '../package-server.cjs';

test('packaged portable executable reads games and configuration beside the outer exe', async () => {
  const packagedExe = process.env.PACKAGE_MANAGER_PORTABLE_EXE;
  test.skip(!packagedExe, 'Requires the Windows portable build');
  test.setTimeout(90000);
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  delete env.PACKAGE_MANAGER_TEST_CONFIG_ROOT;
  delete env.PACKAGE_MANAGER_TEST_GAMES_ROOT;
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  // 便携启动器不转发 Electron 主进程的 inspector 输出，使用浏览器调试端口检查真实成品。
  const directory = await mkdtemp(join(tmpdir(), 'package-manager-portable-'));
  const executablePath = join(directory, 'package-manager.exe');
  await copyFile(packagedExe!, executablePath);
  const packed = join(directory, 'packed');
  const catalogs = await packageServer.createPackageServer(packed);
  const model = { name: 'sample', description: '测试服装', path: '测试团体/测试角色/sample' };
  await fixtures.createPacked(packed, [model], fixtures.createPreviewImage());
  await mkdir(join(directory, 'others'));
  await fixtures.createZip(join(directory, 'others', 'bg.zip'), [['sample/scene.png', 'background']]);
  await writeFile(join(directory, 'resources.json'), JSON.stringify([
    { type: 'background', name: '测试背景', description: '', installPath: 'background/sample', checkPath: 'background/sample/scene.png', url: '/others/bg.zip' },
  ]));
  await writeFile(join(directory, 'package-manager.config.json'), JSON.stringify({
    modelCatalogUrl: catalogs.origin + 'models.json', resourceCatalogUrl: catalogs.origin + 'resources.json',
  }));
  const portableProcess = spawn(executablePath, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, stdio: 'ignore' });
  let browser;
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; }
      catch { return false; }
    }, { timeout: 60000 }).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await expect(page.getByRole('heading', { name: '选择要管理资源的工程' })).toBeVisible();
    const portableGames = join(directory, 'data', 'games');
    const hasPortableGames = await stat(portableGames).then(info => info.isDirectory(), () => false);
    expect(await page.evaluate(async () => (await window.packageManager!.listProjects()).gamesRoot)).toBe(hasPortableGames ? portableGames : join(directory, 'public', 'games'));
    // 请求失败时也应来自 EXE 同级配置所指定的清单，而不是缺失临时目录中的配置文件。
    const result = await page.evaluate(async () => {
      try { return { count: (await window.packageManager!.listModels()).length }; }
      catch (error) { return { error: (error as Error).message }; }
    });
    if ('error' in result) expect(result.error).not.toContain('找不到下载源配置文件');
    await expect(page.getByRole('button', { name: 'WebVideo+共享资源目录未配置' })).toBeDisabled();
    const state = join(directory, 'custom-state'), shared = join(directory, 'shared'), backgrounds = join(directory, 'backdrops');
    await mkdir(join(state, 'user-data'), { recursive: true });
    await mkdir(shared);
    await mkdir(backgrounds);
    const config = join(state, 'config.json');
    await writeFile(config, JSON.stringify({ terreDir: directory }));
    await writeFile(join(directory, 'webvideo-plus.json'), JSON.stringify({ config }));
    await writeFile(join(state, 'user-data', 'shared-assets.json'), JSON.stringify({ libraries: [
      { id: 'general', name: '全类型库', kind: 'all', root: shared },
      { id: 'backgrounds', name: '背景库', kind: 'background', root: backgrounds },
    ] }));
    const project = join(portableGames, '测试工程');
    await mkdir(join(project, 'game'), { recursive: true });
    await writeFile(join(project, 'webgal-engine.json'), JSON.stringify({ id: 'webgal-lovelive.lovelive' }));
    await page.getByRole('button', { name: '重新扫描' }).click();
    await expect(page.locator('.project-list button').first()).toContainText('全类型库');
    await page.getByRole('button', { name: /全类型库/ }).click();
    const modelCatalog = JSON.parse(await readFile(join(packed, 'models.json'), 'utf8'));
    await page.evaluate(async id => {
      await window.packageManager!.listModels();
      await window.packageManager!.installModel('webvideo-shared:general', id, false);
    }, model.path);
    expect(await readFile(join(shared, modelCatalog[0].installPath, 'model.glb'), 'utf8')).toBe('test-model-content');
    await page.getByRole('button', { name: '切换工程' }).click();
    await page.getByRole('button', { name: /背景库/ }).click();
    await expect(page.getByRole('button', { name: /^模型/ })).toHaveCount(0);
    await page.locator('.resource-card').filter({ hasText: '测试背景' }).click();
    await page.getByRole('button', { name: '下载并安装', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新下载', exact: true })).toBeEnabled();
    expect(await readFile(join(backgrounds, 'sample', 'scene.png'), 'utf8')).toBe('background');
    await expect(stat(join(backgrounds, 'background'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await browser?.close();
    if (portableProcess.exitCode === null && portableProcess.pid) {
      await new Promise(resolve => spawn('taskkill', ['/PID', String(portableProcess.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
    }
    await catalogs.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
