const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { findGamesRoot, listProjects, readProject, checkInstalledAt } = require('./projects.cjs');
const { installModel } = require('./model-installer.cjs');
const { installResource, roots } = require('./resource-installer.cjs');
const { listSharedLibraries } = require('./shared-libraries.cjs');
const { readCatalogConfig } = require('./catalog-config.cjs');
const { fetchCatalog, parseCatalog } = require('./catalog-reader.cjs');
const { userError } = require('./user-error.cjs');
const { appDirectory } = require('./app-directory.cjs');
const { engineUpgradeStatus, upgradeEngine } = require('./engine-upgrade.cjs');
const applicationDirectory = appDirectory(app);
const projects = new Map();
const models = new Map();
const resources = new Map();
const installing = new Set();
const gamesRoot = process.env.PACKAGE_MANAGER_TEST === '1' && process.env.PACKAGE_MANAGER_TEST_GAMES_ROOT
  ? process.env.PACKAGE_MANAGER_TEST_GAMES_ROOT
  : null;

function createWindow() {
  const window = new BrowserWindow({
    title: 'WebGAL LoveLive 包管理器', width: 1240, height: 840,
    icon: path.join(__dirname, 'icon.png'),
    minWidth: 860, minHeight: 600, backgroundColor: '#f5f6fa',
    show: false, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  window.once('ready-to-show', () => {
    if (process.env.PACKAGE_MANAGER_TEST !== '1') { window.show(); window.focus(); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.PACKAGE_MANAGER_DEV_URL) {
    const url = new URL(process.env.PACKAGE_MANAGER_DEV_URL);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw Error('Invalid development URL');
    window.loadURL(url.href);
  } else window.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(async () => {
  const configDirectory = process.env.PACKAGE_MANAGER_TEST === '1' && process.env.PACKAGE_MANAGER_TEST_CONFIG_ROOT
    ? process.env.PACKAGE_MANAGER_TEST_CONFIG_ROOT
    : applicationDirectory;
  function handle(channel, callback) {
    ipcMain.handle(channel, async (...args) => {
      try { return await callback(...args); }
      catch (error) { throw userError(error); }
    });
  }
  function verifySender(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== window.webContents.mainFrame) throw Error('无效请求来源');
  }
  async function verifyInstallTarget(project) {
    if (!project.sharedKind) return;
    const current = (await listSharedLibraries(applicationDirectory)).find(library => library.id === project.id);
    if (!current || current.gameRoot !== project.gameRoot || current.sharedKind !== project.sharedKind) {
      throw Error('共享资源目录已变更，请重新选择安装位置。');
    }
  }
  handle('projects:list', async event => {
    verifySender(event);
    const [result, sharedLibraries] = await Promise.all([
      (gamesRoot ? Promise.resolve(gamesRoot) : findGamesRoot(applicationDirectory)).then(listProjects),
      listSharedLibraries(applicationDirectory),
    ]);
    for (const [id, project] of projects) if (project.sharedKind) projects.delete(id);
    sharedLibraries.forEach(library => projects.set(library.id, library));
    result.projects.forEach(project => projects.set(project.id, project));
    return { ...result, sharedLibraries };
  });
  handle('projects:browse', async event => {
    verifySender(event);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '选择包含 webgal-engine.json 的工程目录', properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    const project = await readProject(result.filePaths[0]);
    projects.set(project.id, project);
    return project;
  });
  handle('projects:installed', async (event, id, entries) => {
    verifySender(event);
    const project = projects.get(id);
    if (!project) throw Error('请先选择工程');
    if (!project.sharedKind || project.sharedKind === 'all') return checkInstalledAt(project.gameRoot, entries);
    const prefix = roots[project.sharedKind] + '/';
    const translated = entries.filter(entry => entry.path.startsWith(prefix))
      .map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }));
    const status = await checkInstalledAt(project.gameRoot, translated);
    return Object.fromEntries(Object.entries(status).map(([file, value]) => [prefix + file, value]));
  });
  handle('projects:engine-status', (event, id) => {
    verifySender(event);
    const project = projects.get(id);
    if (!project) throw Error('请先选择工程');
    if (project.sharedKind) return null;
    return engineUpgradeStatus(configDirectory, project.id);
  });
  handle('projects:upgrade-engine', async (event, id) => {
    verifySender(event);
    const project = projects.get(id);
    if (!project || project.sharedKind) throw Error('请先选择工程');
    if (installing.has(id)) throw Error('当前工程正在安装或升级，请完成后重试。');
    installing.add(id);
    try {
      const updated = await upgradeEngine(configDirectory, project.id);
      projects.set(id, updated);
      return updated;
    } finally { installing.delete(id); }
  });
  handle('models:list', async event => {
    verifySender(event);
    const catalogConfig = await readCatalogConfig(configDirectory);
    const { response, catalog } = await fetchCatalog(catalogConfig.modelCatalogUrl, '模型清单');
    const next = parseCatalog(catalog, response.url, 'model');
    models.clear(); next.forEach((value, key) => models.set(key, value));
    return [...models.values()];
  });
  handle('models:install', async (event, id, modelId, overwrite) => {
    verifySender(event);
    const project = projects.get(id), model = models.get(modelId);
    if (!project || !model) throw Error('请先选择工程和模型');
    if (project.sharedKind && project.sharedKind !== 'all') throw Error('此共享资源目录不支持模型');
    if (project.engineId !== 'webgal-lovelive.lovelive') throw Error('当前引擎不支持此模型');
    if (installing.has(id)) throw Error('当前工程正在安装或升级，请完成后重试。');
    installing.add(id);
    try {
      await verifyInstallTarget(project);
      await installModel(project.gameRoot, model, overwrite === true, progress => {
        if (!event.sender.isDestroyed()) event.sender.send('models:progress', { ...progress, projectId: id, path: model.path });
      });
    } finally { installing.delete(id); }
  });
  handle('resources:list', async event => {
    verifySender(event);
    const catalogConfig = await readCatalogConfig(configDirectory);
    const { response, catalog } = await fetchCatalog(catalogConfig.resourceCatalogUrl, '资源清单');
    const next = parseCatalog(catalog, response.url, 'resource');
    resources.clear(); next.forEach((value, key) => resources.set(key, value));
    return [...resources.values()];
  });
  handle('resources:install', async (event, id, url, overwrite) => {
    verifySender(event);
    const project = projects.get(id), resource = resources.get(url);
    if (!project || !resource) throw Error('请先选择工程和资源');
    const direct = !!project.sharedKind && project.sharedKind !== 'all';
    if (direct && project.sharedKind !== resource.type) throw Error('此共享资源目录不支持此类资源');
    if (project.engineId !== 'webgal-lovelive.lovelive' && ['motion', 'live2d_mot_exp'].includes(resource.type)) throw Error('当前引擎不支持此资源');
    if (installing.has(id)) throw Error('当前工程正在安装或升级，请完成后重试。');
    installing.add(id);
    try {
      await verifyInstallTarget(project);
      await installResource(project.gameRoot, resource, overwrite === true, progress => {
        if (!event.sender.isDestroyed()) event.sender.send('models:progress', { ...progress, projectId: id, path: url });
      }, direct);
    } finally { installing.delete(id); }
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
