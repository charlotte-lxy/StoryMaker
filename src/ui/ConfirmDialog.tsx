import { useEffect } from 'react';

interface Props {
  title?: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 应用内的确认框。
 *
 * 不用 window.confirm：它在 Electron 里会同步阻塞渲染进程，返回之后
 * 页面上的输入框和下拉框就点不动了（焦点管理被破坏）。
 * 自己画一个既没这个毛病，样式也能跟界面统一。
 */
export function ConfirmDialog({
  title = '请确认',
  message,
  confirmLabel = '确定',
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>{title}</header>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <footer>
          <button type="button" autoFocus onClick={onCancel}>
            取消
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
