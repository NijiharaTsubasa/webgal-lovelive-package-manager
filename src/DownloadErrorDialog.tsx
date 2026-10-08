import { useEffect, useRef } from 'react';

export default function DownloadErrorDialog({ name, message, onClose, onRetry }: {
  name: string; message: string; onClose: () => void; onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="download-error-title" className="confirm-dialog download-error-dialog" onCancel={onClose}>
    <h2 id="download-error-title">下载或安装失败</h2>
    <p>{name}</p>
    <p role="alert">{message}</p>
    <div><button autoFocus onClick={onClose}>关闭</button><button className="primary" onClick={onRetry}>重试</button></div>
  </dialog>;
}
