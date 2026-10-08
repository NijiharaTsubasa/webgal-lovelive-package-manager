import { test, expect, chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

test('packaged portable executable reads games and configuration beside the outer exe', async () => {
  const executablePath = process.env.PACKAGE_MANAGER_PORTABLE_EXE;
  test.skip(!executablePath, 'Requires the Windows portable build');
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
  const portableProcess = spawn(executablePath!, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, stdio: 'ignore' });
  let browser;
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; }
      catch { return false; }
    }, { timeout: 60000 }).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await expect(page.getByRole('heading', { name: '选择要管理资源的工程' })).toBeVisible();
    const directory = dirname(executablePath!);
    const portableGames = join(directory, 'data', 'games');
    const hasPortableGames = await stat(portableGames).then(info => info.isDirectory(), () => false);
    expect(await page.evaluate(async () => (await window.packageManager!.listProjects()).gamesRoot)).toBe(hasPortableGames ? portableGames : join(directory, 'public', 'games'));
    // 请求失败时也应来自 EXE 同级配置所指定的清单，而不是缺失临时目录中的配置文件。
    const result = await page.evaluate(async () => {
      try { return { count: (await window.packageManager!.listModels()).length }; }
      catch (error) { return { error: (error as Error).message }; }
    });
    if ('error' in result) expect(result.error).not.toContain('找不到下载源配置文件');
  } finally {
    await browser?.close();
    if (portableProcess.exitCode === null && portableProcess.pid) {
      await new Promise(resolve => spawn('taskkill', ['/PID', String(portableProcess.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
    }
  }
});
