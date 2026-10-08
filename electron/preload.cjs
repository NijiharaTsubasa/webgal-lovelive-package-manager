const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    const message = String(error.message ?? error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
    throw new Error(message);
  }
}

contextBridge.exposeInMainWorld('packageManager', {
  listProjects: () => invoke('projects:list'),
  browseProject: () => invoke('projects:browse'),
  listModels: () => invoke('models:list'),
  listResources: () => invoke('resources:list'),
  installResource: (id, url, overwrite) => invoke('resources:install', id, url, overwrite),
  installModel: (id, path, overwrite) => invoke('models:install', id, path, overwrite),
  onDownloadProgress: callback => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('models:progress', listener);
    return () => ipcRenderer.removeListener('models:progress', listener);
  },
  checkInstalled: (id, entries) => invoke('projects:installed', id, entries),
});
