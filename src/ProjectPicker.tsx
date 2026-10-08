import { useEffect, useState } from 'react';
import type { Project } from './desktop';

export default function ProjectPicker({ onSelect, onCancel }: { onSelect: (project: Project) => void; onCancel?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const api = window.packageManager;
    if (!api) { setError('本地工程需要在包管理器桌面窗口中打开。'); setLoading(false); return; }
    void api.listProjects().then(result => {
      if (active) { setProjects(result.projects); setRoot(result.gamesRoot); }
    }).catch(error => { if (active) setError(String(error.message ?? error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  async function browse() {
    setError('');
    try {
      const project = await window.packageManager!.browseProject();
      if (project) onSelect(project);
    } catch (error) { setError(`无法打开工程：${error instanceof Error ? error.message : String(error)}`); }
  }
  return <section className="project-picker" aria-label="选择工程">
    <div className="project-panel"><h2>选择要管理资源的工程</h2><p>选择 games 中的工程，或浏览本地目录。</p><p className="project-root">{root}</p>
      {loading ? <p role="status">正在查找工程…</p> : error ? <p role="alert">{error}</p> : projects.length
        ? <div className="project-list">{projects.map(project => <button key={project.id} onClick={() => onSelect(project)}><strong>{project.name}</strong><span>{project.gameRoot}</span><b>打开 →</b></button>)}</div>
        : <p>未找到工程。请将本工具复制到WebGAL Terre主程序同级目录再执行，或浏览本地目录。</p>}
      <div className="project-actions"><button disabled={!window.packageManager} onClick={() => void browse()}>浏览本地目录</button><button disabled={loading} onClick={() => setRevision(value => value + 1)}>重新扫描</button>{onCancel && <button onClick={onCancel}>取消</button>}</div>
    </div>
  </section>;
}
