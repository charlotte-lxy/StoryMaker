import { DEFAULT_CONNECT_INTERVAL_SEC, type Settings, type UnrealPrefs } from '../state/prefs';
import { UpdateCard } from './UpdatePanel';
import type { UnrealConnection } from './use-unreal-connection';
import type { Updater } from './use-updater';
import { useScrollMemory } from './view-memory';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  updater: Updater;
  /** 「导入到 Unreal」那一组本机配置；素材文件夹和连接参数都放在这里 */
  unrealPrefs: UnrealPrefs;
  onChangeUnrealPrefs: (patch: Partial<UnrealPrefs>) => void;
  /** 挑素材文件夹；网页版 / 本地服务版没有这个能力（传 undefined） */
  pickAssetFolder?: () => Promise<string | null>;
  /** 挑 .uproject 文件 */
  pickUproject?: () => Promise<string | null>;
  /** 与编辑器的连接状态 */
  connection: UnrealConnection;
}

const AUTO_SAVE_ON =
  '编辑后自动写回当前项目文件（选定的那个 .json）；项目内容只存在这个文件里。';

const AUTO_SAVE_OFF = '改动不会自动写回项目文件，请记得点顶部的「保存」。';

export function SettingsEditor({
  settings,
  onChange,
  updater,
  unrealPrefs,
  onChangeUnrealPrefs,
  pickAssetFolder,
  pickUproject,
  connection,
}: Props) {
  const editorRef = useScrollMemory('settings');

  return (
    <div className="editor settings" ref={editorRef}>
      <div className="editor-head">
        <h2>设置</h2>
        <span className="hint">设置只记在这台机器上，不会写进项目文件</span>
      </div>

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>自动保存</strong>
            <span>{settings.autoSave ? AUTO_SAVE_ON : AUTO_SAVE_OFF}</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={(event) => onChange({ autoSave: event.target.checked })}
            />
            <span className="switch-track" />
            <span className="switch-label">{settings.autoSave ? '已开启' : '已关闭'}</span>
          </label>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>主题</strong>
            <span>界面配色，选中立刻生效。</span>
          </div>
          <div className="theme-picker">
            <button
              type="button"
              className={`theme-option${settings.theme === 'light' ? ' active' : ''}`}
              aria-pressed={settings.theme === 'light'}
              onClick={() => onChange({ theme: 'light' })}
            >
              <span className="theme-swatch light" />
              浅色
            </button>
            <button
              type="button"
              className={`theme-option${settings.theme === 'dark' ? ' active' : ''}`}
              aria-pressed={settings.theme === 'dark'}
              onClick={() => onChange({ theme: 'dark' })}
            >
              <span className="theme-swatch dark" />
              深色
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>素材文件夹</strong>
            <span>
              立绘、音效的「素材管理」列和「导入到 Unreal」都从这里找文件；
              文件名（不含扩展名）必须等于图片 ID / 音效 ID。
            </span>
          </div>
        </div>
        <div className="settings-path-row">
          <input
            value={unrealPrefs.assetFolder}
            placeholder={pickAssetFolder === undefined ? '网页版不支持选文件夹' : '还没选，点右边「选择文件夹」'}
            onChange={(event) => onChangeUnrealPrefs({ assetFolder: event.target.value })}
          />
          <button
            type="button"
            disabled={pickAssetFolder === undefined}
            onClick={() => {
              void pickAssetFolder?.().then((picked) => {
                if (picked !== null) onChangeUnrealPrefs({ assetFolder: picked });
              });
            }}
          >
            选择文件夹
          </button>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>Unreal 连接</strong>
            <span>
              连上编辑器后才能选数据表、配前缀，才能点「导出到 UE」。
              连不上不影响编辑，只是导不进去。
            </span>
          </div>
        </div>

        <div className="settings-path-row">
          <input
            value={unrealPrefs.uprojectPath}
            placeholder="E:\Unreal\…\BulletShootGame.uproject"
            onChange={(event) => onChangeUnrealPrefs({ uprojectPath: event.target.value })}
          />
          <button
            type="button"
            disabled={pickUproject === undefined}
            onClick={() => {
              void pickUproject?.().then((picked) => {
                if (picked !== null) onChangeUnrealPrefs({ uprojectPath: picked });
              });
            }}
          >
            选择…
          </button>
        </div>

        <div className="settings-connect-row">
          <button
            type="button"
            className="mini"
            disabled={!connection.available || connection.status === 'checking'}
            onClick={() => void connection.connect()}
          >
            {connection.status === 'checking' ? '检测中…' : '检测连接'}
          </button>
          <ConnectionText connection={connection} />
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>自动连接</strong>
            <span>开着就按下面的间隔定时探测编辑器，连上顶部那个 UE 标签会变绿。</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={unrealPrefs.autoConnect}
              onChange={(event) => onChangeUnrealPrefs({ autoConnect: event.target.checked })}
            />
            <span className="switch-track" />
            <span className="switch-label">{unrealPrefs.autoConnect ? '已开启' : '已关闭'}</span>
          </label>
        </div>

        <div className="settings-path-row settings-interval-row">
          <span className="settings-inline-label">检测间隔</span>
          <input
            type="number"
            min={1}
            max={120}
            value={unrealPrefs.connectIntervalSec}
            disabled={!unrealPrefs.autoConnect}
            onChange={(event) => {
              const next = Math.floor(Number(event.target.value));
              onChangeUnrealPrefs({
                connectIntervalSec:
                  Number.isFinite(next) && next >= 1 ? Math.min(120, next) : DEFAULT_CONNECT_INTERVAL_SEC,
              });
            }}
          />
          <span className="hint">秒（默认 {DEFAULT_CONNECT_INTERVAL_SEC}）</span>
        </div>
      </section>

      <UpdateCard updater={updater} />
    </div>
  );
}

/** 连接状态那一小段文字 */
function ConnectionText({ connection }: { connection: UnrealConnection }) {
  if (!connection.available) return <span className="hint">只有桌面版能连编辑器</span>;
  if (connection.status === 'idle') return <span className="hint">还没检测</span>;
  if (connection.status === 'checking') return <span className="hint">检测中…</span>;
  if (connection.status === 'offline') {
    return <span className="field-error">{connection.message || '没连上'}</span>;
  }
  return (
    <span className="hint">
      已连接 {connection.node?.projectName || '（未命名工程）'}
      {connection.catalogLoading
        ? '，正在读取数据表…'
        : connection.catalog !== null
          ? `，${connection.catalog.dataTables.length} 张数据表`
          : ''}
    </span>
  );
}
