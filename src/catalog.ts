export interface ModelPackage {
  name: string;
  description: string;
  /** 相对于模型分类根目录的路径，最后一层为模型目录。 */
  path: string;
  /** 相对于游戏 game 目录，指向模型 config.json 所在目录。 */
  installPath: string;
  url: string;
  preview?: string;
  bytes?: number;
  unpackedBytes?: number;
}
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = bytes > 0 ? Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1) : 0;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(bytes / 1000 ** index)} ${units[index]}`;
}
export type ResourceType = 'motion' | 'live2d_mot_exp' | 'background' | 'bgm' | 'figure';
export interface ResourcePackage {
  type: ResourceType;
  name: string;
  description: string;
  /** 展示给用户的安装目录，相对于游戏 game 目录。 */
  installPath: string;
  /** 实际检测的目录或文件，相对于游戏 game 目录。 */
  checkPath: string;
  url: string;
  /** 可选预览图地址。 */
  preview?: string;
}
export interface ModelFolder {
  kind: 'folder';
  name: string;
  path: string;
  folders: ModelFolder[];
  models: ModelPackage[];
}
export function buildModelTree(models: ModelPackage[]): ModelFolder {
  const root: ModelFolder = { kind: 'folder', name: '全部模型', path: '', folders: [], models: [] };
  for (const model of models) {
    const parts = model.path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) {
      throw Error(`无效模型路径: ${model.path}`);
    }
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.find(child => child.path === path);
      if (!next) {
        next = { kind: 'folder', name: part, path, folders: [], models: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.models.push(model);
  }
  function sort(folder: ModelFolder) {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    folder.models.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
    folder.folders.forEach(sort);
  }
  sort(root);
  return root;
}
export function allModels(folder: ModelFolder): ModelPackage[] {
  return [...folder.models, ...folder.folders.flatMap(allModels)];
}
export function folderAt(root: ModelFolder, path: string): ModelFolder {
  if (!path) return root;
  for (const folder of root.folders) {
    if (folder.path === path) return folder;
    if (path.startsWith(`${folder.path}/`)) return folderAt(folder, path);
  }
  return root;
}
export function resourcesForTab(resources: ResourcePackage[], tab: 'motion' | 'other') {
  return resources.filter(item => tab === 'motion'
    ? item.type === 'motion' || item.type === 'live2d_mot_exp'
    : item.type === 'background' || item.type === 'bgm' || item.type === 'figure');
}
export function matchesSearch(item: { name: string; description: string; path?: string }, query: string) {
  return `${item.name} ${item.description} ${item.path ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function resourcePreviewUrl(item: Pick<ResourcePackage, 'url' | 'preview'>): string | undefined {
  return item.preview || undefined;
}
