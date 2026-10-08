import { test, expect, _electron } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelPackages, resourcePackages } from '../mock-data';
import fixtures from '../fixtures.cjs';
import packageServer from '../package-server.cjs';

const catalogServers = new Map<string, Awaited<ReturnType<typeof packageServer.createPackageServer>>>();

async function testProjects() {
  const root = await mkdtemp(join(tmpdir(), 'package-manager-electron-'));
  const game = join(root, '工程甲', 'game');
  await mkdir(join(root, '工程乙', 'game'), { recursive: true });
  for (const name of ['工程甲', '工程乙']) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'webgal-engine.json'), JSON.stringify({ id: 'webgal-lovelive.lovelive' }));
  }
  await mkdir(join(root, '其他引擎', 'game'), { recursive: true });
  await writeFile(join(root, '其他引擎', 'webgal-engine.json'), JSON.stringify({ id: 'webgal.mygo' }));
  const model = join(game, modelPackages[0].installPath);
  await mkdir(model, { recursive: true });
  await writeFile(join(model, 'partial.txt'), '');
  await mkdir(join(game, modelPackages[1].installPath), { recursive: true });
  await mkdir(join(game, resourcePackages[0].checkPath), { recursive: true });
  await writeFile(join(game, resourcePackages[0].checkPath, 'partial.txt'), '');
  await fixtures.createPacked(join(root, 'packed'), modelPackages, fixtures.createPreviewImage());
  await mkdir(join(root, 'others'));
  await fixtures.createZip(join(root, 'others', 'hasunosora_motions.zip'), [['hasunosora/test.motionbin', 'test-motion']]);
  await writeFile(join(root, 'others', 'kaho_02070.png'), fixtures.createPreviewImage());
  await writeFile(join(root, 'resources.json'), JSON.stringify(resourcePackages));
  const catalogServer = await packageServer.createPackageServer(join(root, 'packed'));
  catalogServers.set(root, catalogServer);
  await writeFile(join(root, 'package-manager.config.json'), JSON.stringify({
    modelCatalogUrl: `${catalogServer.origin}models.json`, resourceCatalogUrl: `${catalogServer.origin}resources.json`,
  }));
  return root;
}

test('desktop browsing, previews and resource installation', async () => {
  // 覆盖工程选择、多个选项卡、安装检测及两次确认；给完整桌面流程独立预算。
  test.setTimeout(60000);
  const gamesRoot = await testProjects();
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: gamesRoot, PACKAGE_MANAGER_TEST_CONFIG_ROOT: gamesRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    const preview = fixtures.createPreviewImage();
    await page.route('https://example.invalid/**/*.webp', route => route.request().url().endsWith('/hasunosora-motion.webp')
      ? route.fulfill({ contentType: 'image/png', body: preview }) : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '选择要管理资源的工程' })).toBeVisible();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await expect(page.getByRole('heading', { name: '全部模型' })).toBeVisible();
    await expect(page.locator('.folder-card')).toHaveCount(4);
    await expect(page.locator('.folder-card .folder-badge')).toHaveCount(4);
    await page.getByRole('button', { name: '目录 · 2 个模型 虹咲 打开目录 →' }).click();
    await page.locator('.folder-card').click();
    await expect(page.locator('.grid .card')).toHaveCount(2);
    await page.locator('.grid .card').first().click();
    await expect(page.locator('.details')).toContainText('3d/figure/虹咲/09天王寺璃奈/');
    const catalog = JSON.parse(await readFile(join(gamesRoot, 'packed/models.json'), 'utf8'));
    const selectedModel = catalog.find((item: { path: string }) => item.path === modelPackages[4].path);
    await expect(page.getByTestId('download-size')).toHaveAttribute('title', `${selectedModel.bytes.toLocaleString('zh-CN')} 字节`);
    await expect(page.getByTestId('unpacked-size')).toHaveAttribute('title', `${selectedModel.unpackedBytes.toLocaleString('zh-CN')} 字节`);
    await page.getByRole('button', { name: '下载并安装', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新下载', exact: true })).toBeEnabled();
    await expect(page.locator('.grid .card').first().locator('.installed-badge')).toBeVisible();
    expect(await readFile(join(gamesRoot, '工程甲', 'game', modelPackages[4].installPath, 'model.glb'), 'utf8')).toBe('test-model-content');
    await page.getByRole('button', { name: '动作3', exact: true }).click();
    await expect(page.getByRole('note')).toContainText('默认仅在 3D 模型');
    await expect(page.getByRole('note')).toContainText('手动修改 model.json');
    await expect(page.locator('.resource-card')).toHaveCount(3);
    const motionPreview = page.locator('.resource-card').filter({ hasText: resourcePackages[0].name });
    await expect.poll(() => motionPreview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await motionPreview.click();
    await expect(page.getByTestId('download-size')).toHaveCount(0);
    await expect(page.getByTestId('unpacked-size')).toHaveCount(0);
    expect(await motionPreview.locator('p').first().evaluate(element => getComputedStyle(element).whiteSpace)).toBe('pre-line');
    await page.getByRole('button', { name: '重新下载', exact: true }).click();
    await page.getByRole('button', { name: '确认重新下载', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新下载', exact: true })).toBeEnabled();
    expect(await readFile(join(gamesRoot, '工程甲', 'game', '3d/motion/hasunosora/test.motionbin'), 'utf8')).toBe('test-motion');
    await expect.poll(() => page.locator('.details img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const missingPreview = page.locator('.resource-card').filter({ hasText: resourcePackages[1].name });
    await expect(missingPreview.locator('img')).toHaveCount(0);
    await expect(missingPreview.getByRole('img', { name: '默认预览图' })).toBeVisible();
    await expect(missingPreview.locator('.preview-default')).toHaveAttribute('data-resource-type', resourcePackages[1].type);
    expect(await missingPreview.locator('.preview').evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
    await missingPreview.click();
    await expect(page.locator('.details img')).toHaveCount(0);
    await expect(page.locator('.details').getByRole('img', { name: '默认预览图' })).toBeVisible();
    await expect(page.locator('.folder-card')).toHaveCount(0);
    await page.getByRole('button', { name: `其他${resourcePackages.filter(item => !['motion', 'live2d_mot_exp'].includes(item.type)).length}`, exact: true }).click();
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(page.locator('.resource-card')).toHaveCount(resourcePackages.filter(item => !['motion', 'live2d_mot_exp'].includes(item.type)).length);
    await expect(page.locator('.resource-card').filter({ hasText: 'MyGO_Mujica Live2D立绘包' })).toBeVisible();
    const previewOffsets = await page.locator('.resource-card').evaluateAll(cards => cards.map(card => {
      const preview = card.querySelector('.preview')!;
      return Math.round(preview.getBoundingClientRect().top - card.getBoundingClientRect().top);
    }));
    expect(previewOffsets.every(offset => offset === 1)).toBe(true);
    await page.getByRole('button', { name: '模型8', exact: true }).click();
    await page.getByRole('button', { name: '全部模型', exact: true }).last().click();
    await page.getByRole('textbox', { name: '搜索资源' }).fill('高坂穗乃果');
    await expect(page.locator('.grid .card')).toHaveCount(2);
    const installedCard = page.locator('.grid .card').filter({ hasText: modelPackages[0].name });
    await expect(installedCard.locator('.installed-badge')).toBeVisible();
    await expect(page.locator('.grid .card').filter({ hasText: modelPackages[1].name }).locator('.installed-badge')).toHaveCount(0);
    await installedCard.click();
    await page.getByRole('button', { name: '重新下载', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '重新下载', exact: true }).click();
    await page.getByRole('button', { name: '确认重新下载', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新下载', exact: true })).toBeEnabled();
    expect(await readFile(join(gamesRoot, '工程甲', 'game', modelPackages[0].installPath, 'model.glb'), 'utf8')).toBe('test-model-content');
    await page.locator('.grid img').evaluateAll(async (images: HTMLImageElement[]) => {
      await Promise.all(images.map(image => image.decode()));
      if (images.some(image => !image.naturalWidth)) throw Error('Preview failed to load');
    });
    await page.screenshot({ path: 'test-results/package-manager.png' });
    await page.getByRole('button', { name: '切换工程' }).click();
    await page.getByRole('button', { name: /工程乙.*打开/ }).click();
    await page.getByRole('textbox', { name: '搜索资源' }).fill('高坂穗乃果');
    await expect(page.locator('.installed-badge')).toHaveCount(0);
    await page.locator('.grid .card').first().click();
    await expect(page.getByRole('button', { name: '下载并安装', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '切换工程' }).click();
    await page.getByRole('button', { name: /其他引擎.*打开/ }).click();
    await expect(page.locator('.tabs button')).toHaveCount(1);
    await expect(page.locator('.tabs button')).toContainText('其他');
    await expect(page.getByText('当前工程的引擎为：webgal.mygo，只显示引擎支持的内容')).toBeVisible();
    await expect(page.locator('main .motion-notice[role="note"]')).toContainText('当前工程的引擎为：webgal.mygo');
    expect(errors).toEqual([]);
  } finally { await app.close(); await catalogServers.get(gamesRoot)?.close(); await rm(gamesRoot, { recursive: true, force: true }); }
});

test('model and folder previews stay flush with cards of different text heights', async () => {
  const gamesRoot = await testProjects();
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: gamesRoot, PACKAGE_MANAGER_TEST_CONFIG_ROOT: gamesRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await expect(page.locator('.folder-card')).toHaveCount(4);
    async function checkPreviews() {
      await page.locator('.grid .card h3').first().evaluate(element => { element.textContent = '较长的角色及服装说明'.repeat(12); });
      const gaps = await page.locator('.grid .card').evaluateAll(cards => cards.map(card => {
        const bounds = card.getBoundingClientRect();
        const preview = card.querySelector('.preview')!.getBoundingClientRect();
        return { top: Math.round(preview.top - bounds.top), left: Math.round(preview.left - bounds.left), right: Math.round(bounds.right - preview.right) };
      }));
      expect(gaps.every(gap => gap.top === 1 && gap.left === 1 && gap.right === 1)).toBe(true);
    }
    await checkPreviews();
    await page.getByRole('textbox', { name: '搜索资源' }).fill('高坂穗乃果');
    await expect(page.locator('.grid .card')).toHaveCount(2);
    await checkPreviews();
  } finally { await app.close(); await catalogServers.get(gamesRoot)?.close(); await rm(gamesRoot, { recursive: true, force: true }); }
});

test('development server loads inside Electron', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const gamesRoot = await testProjects();
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: gamesRoot, PACKAGE_MANAGER_TEST_CONFIG_ROOT: gamesRoot, PACKAGE_MANAGER_DEV_URL: server.resolvedUrls!.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: ['.'], env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await expect(page.getByRole('heading', { name: '全部模型' })).toBeVisible();
    await expect(page.locator('.folder-card')).toHaveCount(4);
  } finally { await app?.close(); await server.close(); await catalogServers.get(gamesRoot)?.close(); await rm(gamesRoot, { recursive: true, force: true }); }
});

test('failed download opens a visible error dialog and can be retried successfully', async () => {
  const root = await testProjects();
  const item = modelPackages[4];
  const zip = join(root, 'packed', `${item.name}.zip`);
  const original = await readFile(zip);
  await rm(zip);
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: root, PACKAGE_MANAGER_TEST_CONFIG_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await page.getByRole('textbox', { name: '搜索资源' }).fill(item.name);
    await page.locator('.grid .card').click();
    await page.getByRole('button', { name: '下载并安装', exact: true }).click();
    await expect(page.locator('footer')).toContainText('HTTP 404');
    const dialog = page.getByRole('dialog', { name: '下载或安装失败' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByRole('alert')).toContainText('HTTP 404');
    await writeFile(zip, original);
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新下载', exact: true })).toBeEnabled();
    expect(await readFile(join(root, '工程甲/game', item.installPath, 'model.glb'), 'utf8')).toBe('test-model-content');
  } finally { await app.close(); await catalogServers.get(root)?.close(); await rm(root, { recursive: true, force: true }); }
});

test('retry rereads a restored configuration without restarting Electron', async () => {
  const root = await testProjects();
  const configPath = join(root, 'package-manager.config.json');
  const config = await readFile(configPath);
  await rm(configPath);
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: root, PACKAGE_MANAGER_TEST_CONFIG_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('找不到下载源配置文件');
    await expect(page.getByRole('alert')).not.toContainText('Error invoking');
    await expect(page.getByRole('alert')).not.toContainText('ENOENT');
    await writeFile(configPath, config);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.locator('.folder-card')).toHaveCount(4);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: `其他${resourcePackages.filter(item => !['motion', 'live2d_mot_exp'].includes(item.type)).length}`, exact: true }).click();
    await expect(page.locator('.resource-card')).toHaveCount(resourcePackages.filter(item => !['motion', 'live2d_mot_exp'].includes(item.type)).length);
  } finally { await app.close(); await catalogServers.get(root)?.close(); await rm(root, { recursive: true, force: true }); }
});

test('desktop IPC reports configuration and catalog errors clearly and recovers after correction', async () => {
  const root = await testProjects();
  const filename = join(root, 'package-manager.config.json');
  const configText = await readFile(filename, 'utf8');
  const config = JSON.parse(configText);
  const modelFilename = join(root, 'packed/models.json');
  const modelsText = await readFile(modelFilename, 'utf8');
  const resourcesFilename = join(root, 'resources.json');
  const resourcesText = await readFile(resourcesFilename, 'utf8');
  const env = { ...process.env, PACKAGE_MANAGER_TEST: '1', PACKAGE_MANAGER_TEST_GAMES_ROOT: root, PACKAGE_MANAGER_TEST_CONFIG_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PACKAGE_MANAGER_DEV_URL;
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /工程甲.*打开/ }).click();
    await expect(page.locator('.folder-card')).toHaveCount(4);
    const listError = (kind: 'model' | 'resource' = 'model') => page.evaluate(async kind => {
      try {
        await (kind === 'model' ? window.packageManager!.listModels() : window.packageManager!.listResources());
        return 'unexpected success';
      } catch (error) { return (error as Error).message; }
    }, kind);
    await writeFile(filename, '{');
    expect(await listError()).toContain('不是有效的 JSON');
    await writeFile(filename, JSON.stringify({ ...config, modelCatalogUrl: 'http://[' }));
    expect(await listError()).toContain('modelCatalogUrl 必须填写完整');
    await writeFile(filename, JSON.stringify({ ...config, modelCatalogUrl: 'http://127.0.0.1:1/models.json' }));
    expect(await listError()).toContain('无法连接下载源');
    await writeFile(filename, configText);
    await rm(modelFilename);
    expect(await listError()).toContain('HTTP 404');
    await writeFile(modelFilename, '{');
    expect(await listError()).toContain('不是有效的 JSON');
    await writeFile(modelFilename, '[null]');
    expect(await listError()).toContain('模型清单第 1 项');
    const [model] = JSON.parse(modelsText);
    await writeFile(modelFilename, JSON.stringify([{ ...model, url: 'file:///local.zip' }]));
    expect(await listError()).toContain('url 地址无效');
    const [resource] = JSON.parse(resourcesText);
    await writeFile(resourcesFilename, JSON.stringify([{ ...resource, preview: 123 }]));
    const message = await listError('resource');
    expect(message).toContain('资源清单第 1 项：preview');
    expect(message).not.toMatch(/Error invoking|TypeError|ENOENT/);
    await writeFile(modelFilename, modelsText);
    await writeFile(resourcesFilename, resourcesText);
    const recovered = await page.evaluate(async () => ({
      models: (await window.packageManager!.listModels()).length,
      resources: (await window.packageManager!.listResources()).length,
    }));
    expect(recovered).toEqual({ models: modelPackages.length, resources: resourcePackages.length });
  } finally { await app.close(); await catalogServers.get(root)?.close(); await rm(root, { recursive: true, force: true }); }
});
