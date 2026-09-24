import { isDesktop } from '../core/desktop';
import type { Settings } from '../state/prefs';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

const AUTO_SAVE_ON = isDesktop
  ? '编辑后自动写回当前项目文件；还没保存过项目文件时，先记在软件内部，下次打开还在。'
  : '编辑后自动记在本机浏览器里，下次打开还在。';

const AUTO_SAVE_OFF = '改动不会自动保存，请记得点顶部的「保存」。';

export function SettingsEditor({ settings, onChange }: Props) {
  return (
    <div className="editor settings">
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
    </div>
  );
}
