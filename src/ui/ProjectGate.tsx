import type { ReactNode } from 'react';

interface Props {
  /** 还在读上次的项目文件 */
  loading: boolean;
  /** 门槛上的提示：上次的文件打不开、没检测到本地服务等 */
  note: string;
  /** 正在等系统文件对话框 */
  busy: boolean;
  onCreate: () => void;
  onOpen: () => void;
  children?: ReactNode;
}

/**
 * 项目文件门槛。
 *
 * StoryMaker 不在本机缓存项目内容，所有改动都直接写进用户选定的 .json 文件，
 * 所以在确定这个文件之前，编辑界面一律不放出来。
 */
export function ProjectGate({ loading, note, busy, onCreate, onOpen, children }: Props) {
  if (loading) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>正在打开上次的项目…</h1>
          <p className="gate-text">稍等，正在按上次的文件路径读回来。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <span className="brand">
          <span className="brand-mark">SM</span>
          StoryMaker
        </span>

        <h1>先确定一个项目文件</h1>
        <p className="gate-text">
          项目内容不会存在浏览器里，也不会存在软件内部：所有改动都直接写进你选定的
          <b> .json 项目文件</b>，所以每次开工都要先确定这个文件。
        </p>

        <div className="gate-actions">
          <button type="button" className="primary" disabled={busy} onClick={onCreate}>
            新建项目文件
          </button>
          <button type="button" disabled={busy} onClick={onOpen}>
            打开已有项目文件
          </button>
        </div>

        <p className="gate-tip">
          第一次用请点「新建项目文件」，选一个位置存成 .json（例如
          <code>D:\策划\序章.json</code>），之后每次打开都会自动读回它。
        </p>

        {note !== '' && <p className="gate-note">{note}</p>}
        {children}
      </div>
    </div>
  );
}
