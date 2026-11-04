export interface Project { id: string; name: string; gameRoot: string; engineId: string; engineVersion?: string; sharedKind?: 'all' | 'figure' | 'background' | 'bgm' }
export interface EngineStatus { currentVersion: string; latestVersion: string; available: boolean; themeNotice?: string }
export interface InstallStatus { installed: boolean; error?: string }
export interface DownloadProgress { projectId: string; path: string; state: 'downloading' | 'extracting' | 'installing' | 'installed'; received: number; total: number; files?: number; totalFiles?: number }
export interface DesktopApi {
  listProjects(): Promise<{ gamesRoot: string; projects: Project[]; sharedLibraries: Project[] }>;
  browseProject(): Promise<Project | null>;
  engineStatus(id: string): Promise<EngineStatus | null>;
  upgradeEngine(id: string): Promise<Project & { themeNotice?: string }>;
  listModels(): Promise<import('./catalog').ModelPackage[]>;
  listResources(): Promise<import('./catalog').ResourcePackage[]>;
  installResource(id: string, url: string, overwrite: boolean): Promise<void>;
  installModel(id: string, path: string, overwrite: boolean): Promise<void>;
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  checkInstalled(id: string, entries: { path: string; directoryOnly: boolean }[]): Promise<Record<string, InstallStatus>>;
}
declare global { interface Window { packageManager?: DesktopApi } }
