import { useState } from 'react';

import type { CollabStatus } from '../core/collab/protocol';

interface Props {
  status: CollabStatus;
  detail: string;
  url: string;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
}

const DOT_CLASS: Record<CollabStatus, string> = {
  offline: 'off',
  connecting: 'wait',
  online: 'on',
};

function statusText(status: CollabStatus, detail: string): string {
  if (status === 'online') return `已连接：${detail}`;
  if (status === 'connecting') return `正在连接 ${detail}…`;
  return detail === '' ? '未连接——照常编辑，只是不同步' : detail;
}

/**
 * 右上角的协作状态：一个小圆点，点开是连接面板。
 *
 * 圆点必须常驻可见——「我现在到底在不在同步」是用户随时要能确认的事，
 * 不能藏在菜单里。连不上时显示灰点，但绝不出弹窗打断编辑。
 */
export function CollabBadge({ status, detail, url, onConnect, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);

  const toggle = (): void => {
    setDraft(url);
    setOpen((current) => !current);
  };

  return (
    <div className="collab-summary">
      <button
        type="button"
        className={`collab-badge ${DOT_CLASS[status]}`}
        title={`协作：${statusText(status, detail)}`}
        onClick={toggle}
      >
        <span className="collab-dot" />
        协作
      </button>

      {open && (
        <>
          <div className="collab-mask" onClick={() => setOpen(false)} />
          <div className="collab-pop">
            <h3>多人同步</h3>
            <label className="collab-field">
              <span>服务端地址</span>
              <input
                value={draft}
                placeholder="ws://192.168.1.20:1999"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onConnect(draft.trim());
                    setOpen(false);
                  }
                }}
              />
            </label>
            <p className="collab-hint">{statusText(status, detail)}</p>
            <div className="collab-actions">
              {status === 'offline' ? (
                <button
                  type="button"
                  className="primary"
                  disabled={draft.trim() === ''}
                  onClick={() => {
                    onConnect(draft.trim());
                    setOpen(false);
                  }}
                >
                  连接
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onDisconnect();
                    setOpen(false);
                  }}
                >
                  断开
                </button>
              )}
            </div>
            <p className="collab-note">
              断开或连不上都不影响编辑，改动照常存进项目文件；连上以后会把两边的差异合起来。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
