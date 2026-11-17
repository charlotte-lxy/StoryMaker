import type { UpdateNote } from '../core/host';
import { formatSize, type Updater } from './use-updater';

/** 设置页里的「版本与更新」卡片 */
export function UpdateCard({ updater }: { updater: Updater }) {
  const busy = updater.phase === 'checking' || updater.phase === 'downloading';

  return (
    <section className="settings-card">
      <div className="settings-item">
        <div className="settings-text">
          <strong>版本与更新</strong>
          <span>当前版本 v{updater.version}</span>
          <span className={`update-status ${toneOf(updater.phase)}`}>{statusText(updater)}</span>
        </div>
        <div className="update-actions">
          {updater.phase === 'available' && (
            <button type="button" className="primary" onClick={updater.download}>
              下载更新
            </button>
          )}
          {updater.phase === 'ready' && (
            <button type="button" className="danger" onClick={updater.apply}>
              重启并安装
            </button>
          )}
          <button
            type="button"
            disabled={busy || updater.phase === 'unsupported'}
            onClick={updater.check}
          >
            {updater.phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
        </div>
      </div>

      {updater.phase === 'ready' && (
        <p className="update-hint">更新已下载，点「重启并安装」会关闭软件并自动重启。</p>
      )}
      {(updater.phase === 'available' || updater.phase === 'ready') && (
        <UpdateNotes notes={updater.notes} />
      )}
      {updater.phase === 'available' && (
        <p className="update-hint">下载只包含变动的 app.asar（约 {formatSize(updater.size)}），重启后生效。</p>
      )}
      {updater.phase === 'unsupported' && (
        <p className="update-hint">网页版、本地服务版和开发模式不支持自动更新。</p>
      )}
    </section>
  );
}

/** 启动时后台检查到新版的提示框 */
export function UpdatePrompt({ updater }: { updater: Updater }) {
  const notice = updater.notice;
  if (notice === null) return null;

  return (
    <div className="modal-mask">
      <div className="modal confirm-modal update-modal" role="dialog" aria-modal="true">
        <header>发现新版本</header>
        <div className="modal-body">
          <p className="confirm-message">
            当前版本 v{notice.current}，最新版本 v{notice.latest}。
            {'\n'}
            下载只包含变动的程序文件（约 {formatSize(notice.size)}），重启后生效。
          </p>
          <UpdateNotes notes={notice.notes ?? updater.notes} />
          {updater.phase === 'downloading' && <p className="update-hint">正在下载，请稍候…</p>}
          {updater.phase === 'ready' && (
            <p className="update-hint">下载完成，点「重启并安装」立即更新。</p>
          )}
          {updater.phase === 'error' && (
            <p className="update-hint update-status error">下载失败：{updater.message}，可以稍后重试。</p>
          )}
        </div>
        <footer>
          <button type="button" onClick={updater.dismissNotice}>
            稍后
          </button>
          {updater.phase === 'available' && (
            <button type="button" className="primary" autoFocus onClick={updater.download}>
              下载更新
            </button>
          )}
          {updater.phase === 'downloading' && (
            <button type="button" disabled>
              下载中…
            </button>
          )}
          {updater.phase === 'ready' && (
            <button type="button" className="danger" autoFocus onClick={updater.apply}>
              重启并安装
            </button>
          )}
          {updater.phase === 'error' && (
            <button type="button" className="primary" onClick={updater.download}>
              重试
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** 从当前版本到最新版本的更新内容，按版本分组 */
function UpdateNotes({ notes }: { notes: UpdateNote[] }) {
  if (notes.length === 0) {
    return <p className="update-hint">这次更新没有附带更新说明。</p>;
  }

  return (
    <div className="update-notes">
      {notes.map((note) => (
        <section key={note.version} className="update-note">
          <h4>v{note.version}</h4>
          <ul>
            {note.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function toneOf(phase: Updater['phase']): string {
  if (phase === 'error') return 'error';
  if (phase === 'available' || phase === 'ready') return 'ok';
  return '';
}

function statusText(updater: Updater): string {
  switch (updater.phase) {
    case 'checking':
      return '正在检查更新…';
    case 'latest':
      return `已经是最新版本（远端 v${updater.latest}）。`;
    case 'available':
      return `发现新版本 v${updater.latest}（约 ${formatSize(updater.size)}）。`;
    case 'downloading':
      return '正在下载更新…';
    case 'ready':
      return '更新已下载，重启后生效。';
    case 'error':
      return `没能连上更新源：${updater.message}。不影响继续使用。`;
    case 'unsupported':
      return '当前环境不支持自动更新。';
    default:
      return '软件启动时会在后台检查一次，也可以手动检查。';
  }
}
