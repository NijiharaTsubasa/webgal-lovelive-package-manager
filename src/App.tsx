import { useEffect, useMemo, useState } from 'react';
import type { ModelFolder, ModelPackage, ResourcePackage, ResourceType } from './catalog';
import { allModels, buildModelTree, folderAt, matchesSearch, resourcesForTab, resourcePreviewUrl, formatBytes } from './catalog';
import type { DownloadProgress, InstallStatus, Project } from './desktop';
import ProjectPicker from './ProjectPicker';
import RedownloadDialog from './RedownloadDialog';
import DownloadErrorDialog from './DownloadErrorDialog';

type Tab = 'model' | 'motion' | 'other';
type Package = ModelPackage | ResourcePackage;
const labels = { motion: '3D 动作', live2d_mot_exp: 'Live2D 动作与表情', background: '背景', bgm: '音乐', figure: '立绘' };
function detectionPath(item: Package) { return 'path' in item ? item.installPath : item.checkPath; }

const previewIcons = {
  model: 'M20 28a12 12 0 1 0 24 0a12 12 0 1 0-24 0 M12 56v-4a20 20 0 0 1 40 0v4',
  motion: 'M24 14l24 18-24 18z',
  live2d_mot_exp: 'M12 12h40v40H12z M22 27h2 M40 27h2 M23 38q9 10 18 0',
  background: 'M8 12h48v40H8z M9 44l14-13 11 10 9-8 12 11 M20 22h6v6h-6z',
  bgm: 'M28 44V16l24-5v28 M28 23l24-5 M28 44c0 10-16 10-16 2s16-8 16-2 M52 39c0 10-16 10-16 2s16-8 16-2',
  figure: 'M20 23a12 12 0 1 0 24 0a12 12 0 1 0-24 0 M12 55v-4a20 20 0 0 1 40 0v4',
};
function Preview({ src, label, className = '', type = 'model' }: { src?: string; label: string; className?: string; type?: ResourceType | 'model' }) {
  const [failedSource, setFailedSource] = useState<string>();
  const hasPreview = !!src && failedSource !== src;
  return <div className={`preview ${className} ${hasPreview ? '' : 'preview-empty'}`}>{hasPreview
    ? <img src={src} alt={label} loading="lazy" onError={() => setFailedSource(src)} />
    : <div className="preview-default" data-resource-type={type}>
      <svg className="preview-placeholder" viewBox="0 0 64 64" role="img" aria-label="默认预览图"><path d={previewIcons[type]} /></svg>
      <span>{type === 'model' ? '3D 模型' : labels[type]}</span>
    </div>}</div>;
}
function ResourcePreview({ item }: { item: ResourcePackage }) {
  return <Preview className="resource-preview" src={resourcePreviewUrl(item)} label={item.name} type={item.type} />;
}
function Directory({ folder, current, go }: { folder: ModelFolder; current: string; go: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <li>
    <div className={`tree-row ${current === folder.path ? 'active' : ''}`}>
      {folder.folders.length > 0 ? <button className="disclosure" aria-label={`${expanded ? '折叠' : '展开'}${folder.name}`}
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '⌄' : '›'}</button> : <span className="disclosure" />}
      <button className="tree-name" onClick={() => { setExpanded(true); go(folder.path); }}>{folder.name}<small>{allModels(folder).length}</small></button>
    </div>
    {(expanded || current.startsWith(`${folder.path}/`)) && folder.folders.length > 0 && <ul>{folder.folders.map(child => <Directory key={child.path} folder={child} current={current} go={go} />)}</ul>}
  </li>;
}
export default function App() {
  const [modelPackages, setModelPackages] = useState<ModelPackage[]>([]);
  const [resourcePackages, setResourcePackages] = useState<ResourcePackage[]>([]);
  const [resourceError, setResourceError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress>();
  const root = useMemo(() => buildModelTree(modelPackages), [modelPackages]);
  const installationEntries = useMemo(() => [
    ...modelPackages.map(item => ({ path: item.installPath, directoryOnly: true })),
    ...resourcePackages.map(item => ({ path: item.checkPath, directoryOnly: false })),
  ], [modelPackages, resourcePackages]);
  const [tab, setTab] = useState<Tab>('model');
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Package>();
  const [notice, setNotice] = useState('');
  const [project, setProject] = useState<Project>();
  const [choosingProject, setChoosingProject] = useState(true);
  const [installation, setInstallation] = useState<{ project: string; status: Record<string, InstallStatus> }>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkRevision, setCheckRevision] = useState(0);
  const [redownload, setRedownload] = useState<Package>();
  const [downloadFailure, setDownloadFailure] = useState<{ item: Package; overwrite: boolean; message: string }>();
  useEffect(() => {
    let active = true;
    setCatalogLoading(true); setCatalogError('');
    if (!window.packageManager) { setCatalogLoading(false); return; }
    void window.packageManager.listModels().then(models => {
      buildModelTree(models);
      if (active) setModelPackages(models);
    }).catch(error => { if (active) setCatalogError(String(error.message ?? error)); })
      .finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [catalogRevision]);
  useEffect(() => window.packageManager?.onDownloadProgress(setProgress), []);
  useEffect(() => {
    let active = true;
    if (!window.packageManager) return;
    setResourceError('');
    void window.packageManager.listResources().then(items => { if (active) setResourcePackages(items); })
      .catch(error => { if (active) setResourceError(String(error.message ?? error)); });
    return () => { active = false; };
  }, [catalogRevision]);
  useEffect(() => {
    if (!project) return;
    let active = true;
    setChecking(true); setCheckError('');
    void window.packageManager!.checkInstalled(project.id, installationEntries).then(status => {
      if (active) setInstallation({ project: project.id, status });
    }).catch(error => { if (active) setCheckError(String(error.message ?? error)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [project, checkRevision, installationEntries]);
  useEffect(() => {
    const refresh = () => setCheckRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const statusOf = (item: Package) => installation?.project === project?.id ? installation?.status[detectionPath(item)] : undefined;
  const selectedStatus = selected && statusOf(selected);
  const statusReady = installation?.project === project?.id && !checking && !checkError;
  const folder = folderAt(root, path);
  const models = tab !== 'model' ? [] : query.trim() ? allModels(folder).filter(item => matchesSearch(item, query)) : folder.models;
  const folders = tab !== 'model' || query.trim() ? [] : folder.folders;
  const resources = tab === 'model' ? [] : resourcesForTab(resourcePackages, tab).filter(item => matchesSearch(item, query));
  function go(next: string) { setPath(next); setQuery(''); setSelected(undefined); }
  function changeTab(next: Tab) { setTab(next); setQuery(''); setSelected(undefined); }
  async function download(item: Package, overwrite = false) {
    setDownloadFailure(undefined);
    setDownloading(true); setProgress(undefined); setNotice('正在下载…');
    try {
      if ('path' in item) await window.packageManager!.installModel(project!.id, item.path, overwrite);
      else await window.packageManager!.installResource(project!.id, item.url, overwrite);
      setNotice(`“${item.description || item.name}”已安装。`);
      setCheckRevision(value => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(`安装失败：${message}`);
      setDownloadFailure({ item, overwrite, message });
    }
    finally { setDownloading(false); }
  }
  function chooseProject(next: Project) {
    setTab(next.engineId === 'webgal-lovelive.lovelive' ? 'model' : 'other');
    setQuery(''); setSelected(undefined); setPath('');
    setProject(next); setChoosingProject(false); setNotice(''); setRedownload(undefined); setDownloadFailure(undefined);
    setInstallation(undefined);
  }
  if (choosingProject || !project) return <div className="app">
    <header className="header"><div className="brand-icon">W</div><div><h1>WebGAL LoveLive</h1><span className="subtitle">包管理器</span></div></header>
    <ProjectPicker onSelect={chooseProject} onCancel={project ? () => setChoosingProject(false) : undefined} />
  </div>;
  return <div className="app">
    <header className="header"><div className="brand-icon">W</div><div><h1>WebGAL LoveLive</h1><span className="subtitle">包管理器</span></div><div className="project-current"><span>当前工程：{project.name}</span><button disabled={downloading} onClick={() => setChoosingProject(true)}>切换工程</button><button disabled={checking} onClick={() => setCheckRevision(value => value + 1)}>刷新安装状态</button></div></header>
    <nav className="tabs" aria-label="资源类别">{([['model', '模型'], ['motion', '动作'], ['other', '其他']] as const).filter(([key]) => project.engineId === 'webgal-lovelive.lovelive' || key === 'other').map(([key, title]) => <button key={key}
      aria-pressed={tab === key} className={tab === key ? 'selected' : ''} onClick={() => changeTab(key)}>{title}<span>{key === 'model' ? modelPackages.length : resourcesForTab(resourcePackages, key).length}</span></button>)}</nav>
    <div className="workspace">
      <aside className="sidebar"><div className="section-title">{tab === 'model' ? '模型目录' : '资源分类'}</div>
        {tab === 'model' ? <><button className={`all-button ${!path ? 'active' : ''}`} onClick={() => go('')}>全部模型<span>{modelPackages.length}</span></button><ul className="tree">{root.folders.map(group => <Directory key={group.path} folder={group} current={path} go={go} />)}</ul></>
          : <div className="category-note">{tab === 'motion' ? '3D 动作\nLive2D 动作与表情' : '立绘\n背景\n音乐'}</div>}
        <div className="sidebar-foot">按需选择资源包</div>
      </aside>
      <main>
        {tab === 'model' && catalogLoading && <p role="status">正在下载模型清单…</p>}
        {tab === 'model' && catalogError && <div className="catalog-error" role="alert"><p>{catalogError}</p><button onClick={() => setCatalogRevision(value => value + 1)}>重试</button></div>}
        {tab !== 'model' && resourceError && <div className="catalog-error" role="alert"><p>{resourceError}</p><button onClick={() => setCatalogRevision(value => value + 1)}>重试</button></div>}
        {checking && <p className="install-message" role="status">正在检测已安装资源…</p>}
        {checkError && <p className="install-message" role="alert">安装检测失败：{checkError}</p>}
        <div className="content-heading"><div><h2>{tab === 'model' ? folder.name : tab === 'motion' ? '动作与表情' : '立绘、背景与音乐'}</h2><p>{tab === 'model' ? '按团体和角色浏览，选择需要的服装模型。' : '查看资源包内容，选择需要的素材。'}</p></div>
          <label className="search"><span>⌕</span><input aria-label="搜索资源" placeholder={tab === 'model' ? '搜索当前目录的角色、服装…' : '搜索名称、说明…'} value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}>×</button>}</label></div>
        {project.engineId !== 'webgal-lovelive.lovelive' && <div className="motion-notice" role="note">
          <p>当前工程的引擎为：{project.engineId}，只显示引擎支持的内容</p>
        </div>}
        {tab === 'motion' && <div className="motion-notice" role="note">
          <strong>注意</strong>
          <p>本页面下载的表情／动作默认仅在 3D 模型的表情／动作列表中可见，即使显示的类型是“Live2D 动作与表情”也是如此。如需在 Live2D 模型中使用，您需要手动修改 <code>model.json</code>，加入对应的表情和动作。</p>
        </div>}
        {tab === 'model' && <nav className="breadcrumbs" aria-label="模型路径"><button onClick={() => go('')}>全部模型</button>{path.split('/').filter(Boolean).map((part, index, parts) => <span key={index}> / <button onClick={() => go(parts.slice(0, index + 1).join('/'))}>{part}</button></span>)}</nav>}
        <div className="grid">
          {folders.map(item => <button className="card folder-card" key={item.path} onClick={() => go(item.path)}><span className="folder-badge" aria-label="文件夹"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 5h7l2 2h9v13H3z" fill="currentColor" /></svg></span><Preview src={allModels(item)[0]?.preview} label={item.name} /><div className="card-info"><span className="card-kicker">目录 · {allModels(item).length} 个模型</span><h3>{item.name}</h3><p>打开目录 →</p></div></button>)}
          {models.map(item => <button className={`card ${selected?.url === item.url ? 'chosen' : ''}`} key={item.path} onClick={() => setSelected(item)}>{statusOf(item)?.installed && <span className="installed-badge">已安装</span>}<Preview src={item.preview} label={item.description} /><div className="card-info"><span className="card-kicker">3D 模型</span><h3>{item.description}</h3><p>{item.name}</p>{statusOf(item)?.error && <p className="status-error">检测失败</p>}</div></button>)}
          {resources.map(item => <button className={`card resource-card ${selected?.url === item.url ? 'chosen' : ''}`} key={item.url} onClick={() => setSelected(item)}>{statusOf(item)?.installed && <span className="installed-badge">已安装</span>}<ResourcePreview item={item} /><div className="card-info"><span className="card-kicker">{labels[item.type]}</span><h3>{item.name}</h3><p>{item.description}</p>{statusOf(item)?.error && <p className="status-error">检测失败</p>}</div></button>)}
        </div>
        {!folders.length && !models.length && !resources.length && <div className="empty">没有找到匹配的资源。<button onClick={() => setQuery('')}>清除搜索</button></div>}
      </main>
      <aside className="details"><div className="section-title">资源详情</div>{selected ? <>
        {'path' in selected ? <Preview key={selected.url} src={selected.preview} label={selected.description} /> : <ResourcePreview key={selected.url} item={selected} />}
        <h3>{selected.description && 'path' in selected ? selected.description : selected.name}</h3>
        <p>{selected.description}</p><dl><dt>资源名称</dt><dd>{selected.name}</dd><dt>安装目录（相对于 game）</dt><dd>{selected.installPath}</dd>
          {'path' in selected && <>
            {selected.bytes !== undefined && <><dt>下载大小</dt><dd data-testid="download-size" title={`${selected.bytes.toLocaleString('zh-CN')} 字节`}>{formatBytes(selected.bytes)}</dd></>}
            {selected.unpackedBytes !== undefined && <><dt>解压后大小</dt><dd data-testid="unpacked-size" title={`${selected.unpackedBytes.toLocaleString('zh-CN')} 字节`}>{formatBytes(selected.unpackedBytes)}</dd></>}
          </>}
        </dl>
        {selectedStatus?.error && <p role="alert">检测失败：{selectedStatus.error}</p>}
        <button className="primary" disabled={downloading || !statusReady || !!selectedStatus?.error} onClick={() => selectedStatus?.installed ? setRedownload(selected) : void download(selected)}>{downloading ? '正在安装…' : selectedStatus?.installed ? '重新下载' : '下载并安装'}</button>
      </> : <div className="detail-empty">选择一个资源包<br />查看说明和目录</div>}
        {downloading && progress && <div className="download-progress" role="status"><p>{progress.state === 'extracting' ? `正在解压…${progress.files ? ` ${progress.files}/${progress.totalFiles}` : ''}` : progress.state === 'installing' ? '正在安装…' : progress.state === 'installed' ? '安装完成' : `正在下载：${progress.total ? `${Math.round(progress.received / progress.total * 100)}%` : ''}`}<br />{(progress.received / 1048576).toFixed(1)} MB{progress.total > 0 && ` / ${(progress.total / 1048576).toFixed(1)} MB`}</p>{progress.total > 0 ? <progress value={progress.received} max={progress.total} /> : <progress />}</div>}
      </aside>
    </div>
    <footer><span role="status">{notice}</span></footer>
    {redownload && <RedownloadDialog name={redownload.description || redownload.name} onCancel={() => setRedownload(undefined)} onConfirm={() => { void download(redownload, true); setRedownload(undefined); }} />}
    {downloadFailure && <DownloadErrorDialog name={downloadFailure.item.description || downloadFailure.item.name}
      message={downloadFailure.message} onClose={() => setDownloadFailure(undefined)}
      onRetry={() => void download(downloadFailure.item, downloadFailure.overwrite)} />}
  </div>;
}
