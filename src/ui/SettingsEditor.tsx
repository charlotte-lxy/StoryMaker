import type { Settings, UnrealPrefs } from '../state/prefs';
import { UpdateCard } from './UpdatePanel';
import type { Updater } from './use-updater';
import { useScrollMemory } from './view-memory';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  updater: Updater;
  /** 「导入到 Unreal」那一组本机配置；素材文件夹就放在这里 */
  unrealPrefs: UnrealPrefs;
  onChangeUnrealPrefs: (patch: Partial<UnrealPrefs>) => void;
  /** 挑素材文件夹；网页版 / 本地服务版没有这个能力（传 undefined） */
  pickAssetFolder?: () => Promise<string | null>;
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

      <UpdateCard updater={updater} />
    </div>
  );
}
