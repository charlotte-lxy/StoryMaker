import { useState } from 'react';

import { displayNameOf, type Collaborator } from '../core/collab/presence';
import type { CollabStatus } from '../core/collab/protocol';
import { COLLAB_COLORS, collabColorValue, type CollabColor } from '../state/prefs';

interface Props {
  status: CollabStatus;
  detail: string;
  url: string;
  /** 当前在线的成员，第一个永远是自己 */
  collaborators: Collaborator[];
  myName: string;
  myColor: CollabColor;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: CollabColor) => void;
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
 * 右上角的协作状态：一个小圆点加在线人数，点开是连接面板。
 *
 * 圆点常驻可见是刻意的——「我现在到底在不在同步、还有谁在」是随时要能确认的事，
 * 藏进菜单里等于没有。连不上时显示灰点，但绝不出弹窗打断编辑。
 *
 * 人数靠客户端之间的心跳攒出来（服务端只转发、不给成员表），所以掉线的人要等
 * 十五秒超时才会从名单上消失——这是那套服务端决定的，不是这里偷懒。
 */
export function CollabBadge({
  status,
  detail,
  url,
  collaborators,
  myName,
  myColor,
  onConnect,
  onDisconnect,
  onRename,
  onRecolor,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  const [nameDraft, setNameDraft] = useState(myName);

  const toggle = (): void => {
    setDraft(url);
    setNameDraft(myName);
    setOpen((current) => !current);
  };

  /** 名字改完才提交：边打字边广播会把心跳刷爆 */
  const commitName = (): void => {
    const trimmed = nameDraft.trim();
    if (trimmed !== myName) onRename(trimmed);
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
        {status === 'online' ? `协作 ${collaborators.length}` : '协作'}
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

            <label className="collab-field">
              <span>我的名字</span>
              <input
                value={nameDraft}
                placeholder="未命名用户"
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitName();
                }}
              />
            </label>

            <div className="collab-field">
              <span>标记颜色</span>
              <div className="collab-colors">
                {COLLAB_COLORS.map((color) => (
                  <button
                    key={color.key}
                    type="button"
                    className={`collab-color ${myColor === color.key ? 'on' : ''}`}
                    style={{ background: color.value }}
                    title={color.label}
                    aria-label={color.label}
                    onClick={() => onRecolor(color.key)}
                  />
                ))}
              </div>
            </div>

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

            <div className="collab-members">
              <span>正在协作（{collaborators.length}）</span>
              <ul>
                {collaborators.map((person, index) => (
                  <li key={person.clientId}>
                    <span
                      className="collab-dot"
                      style={{ background: collabColorValue(person.color) }}
                    />
                    {displayNameOf(person)}
                    {index === 0 && <em>（我）</em>}
                  </li>
                ))}
              </ul>
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
