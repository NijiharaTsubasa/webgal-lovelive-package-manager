import { useEffect, useRef } from 'react';

export default function RedownloadDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="redownload-title" className="confirm-dialog" onCancel={onCancel}>
    <h2 id="redownload-title">确认重新下载？</h2><p>“{name}”已安装。重新下载会覆盖对应资源。</p>
    <div><button autoFocus onClick={onCancel}>取消</button><button className="primary" onClick={onConfirm}>确认重新下载</button></div>
  </dialog>;
}
