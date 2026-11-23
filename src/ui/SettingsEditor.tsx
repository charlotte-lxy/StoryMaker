import { modulesForEngine } from '../core/modules';
import type { EngineKind, ModuleId } from '../core/types';
import { DEFAULT_CONNECT_INTERVAL_SEC, type Settings, type UnrealPrefs } from '../state/prefs';
import { UpdateCard } from './UpdatePanel';
import type { GodotConnection } from './use-godot-connection';
import type { UnrealConnection } from './use-unreal-connection';
import type { Updater } from './use-updater';
import { useRememberedChoice, useScrollMemory } from './view-memory';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  updater: Updater;
  /** 引擎连接的本机配置：Unreal / Godot 的工程路径、自动连接参数都放在这里 */
  unrealPrefs: UnrealPrefs;
  onChangeUnrealPrefs: (patch: Partial<UnrealPrefs>) => void;
  /** 当前项目面向的引擎（记在项目文件里，不是本机设置） */
  engine: EngineKind;
  /** 换引擎：写进项目文件，同时记下「上次选的」给新建项目当默认 */
  onChangeEngine: (engine: EngineKind) => void;
  /** 项目里关掉的模块（必需模块不在这里） */
  disabledModules: ModuleId[];
  onToggleModule: (id: ModuleId, on: boolean) => void;
  /** 挑素材文件夹；网页版 / 本地服务版没有这个能力（传 undefined） */
  pickAssetFolder?: () => Promise<string | null>;
  /** 挑 .uproject 文件 */
  pickUproject?: () => Promise<string | null>;
  /** 挑 project.godot 文件 */
  pickGodotProject?: () => Promise<string | null>;
  /** 与 Unreal 编辑器的连接状态 */
  connection: UnrealConnection;
  /** 与 Godot 编辑器的连接状态（含插件装没装） */
  godotConnection: GodotConnection;
}

const AUTO_SAVE_ON =
  '编辑后自动写回当前项目文件（选定的那个 .json）；项目内容只存在这个文件里。';

const AUTO_SAVE_OFF = '改动不会自动写回项目文件，请记得点顶部的「保存」。';

const SECTIONS = [
  { id: 'engine', label: '引擎连接' },
  { id: 'modules', label: '模块' },
  { id: 'general', label: '通用' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsEditor({
  settings,
  onChange,
  updater,
  unrealPrefs,
  onChangeUnrealPrefs,
  engine,
  onChangeEngine,
  disabledModules,
  onToggleModule,
  pickAssetFolder,
  pickUproject,
  pickGodotProject,
  connection,
  godotConnection,
}: Props) {
  const editorRef = useScrollMemory('settings');
  // 默认停在「通用」：自动保存、主题、素材文件夹是平时最常改的；引擎连接点左边切过去
  const [section, chooseSection] = useRememberedChoice<SectionId>('settings:section', 'general');

  const engineLabel = engine === 'godot' ? 'Godot' : 'Unreal';

  const engineSection = (
    <>
      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>引擎</strong>
            <span>
              这个项目面向 Unreal 还是 Godot。侧边栏给哪组模块、顶部工具栏右侧的标签、
              自动连接探测谁，都跟着它走；「导出到 UE」入口不受影响。换引擎不会删数据。
            </span>
          </div>
          <select
            value={engine}
            onChange={(event) => onChangeEngine(event.target.value === 'godot' ? 'godot' : 'unreal')}
          >
            <option value="unreal">Unreal</option>
            <option value="godot">Godot</option>
          </select>
        </div>
      </section>

      {engine === 'unreal' ? (
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
              placeholder="E:\\Unreal\\…\\BulletShootGame.uproject"
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
      ) : (
        <section className="settings-card">
          <div className="settings-item">
            <div className="settings-text">
              <strong>Godot 连接</strong>
              <span>
                先选 Godot 工程（project.godot），再装插件。插件装好后要重启一次 Godot
                编辑器，它才会在本机开端口，StoryMaker 才连得上。
              </span>
            </div>
          </div>

          <div className="settings-path-row">
            <input
              value={unrealPrefs.godotProjectPath}
              placeholder="E:\\Godot\\…\\project.godot"
              onChange={(event) => onChangeUnrealPrefs({ godotProjectPath: event.target.value })}
            />
            <button
              type="button"
              disabled={pickGodotProject === undefined}
              onClick={() => {
                void pickGodotProject?.().then((picked) => {
                  if (picked !== null) onChangeUnrealPrefs({ godotProjectPath: picked });
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
              disabled={!godotConnection.available || godotConnection.status === 'checking'}
              onClick={() => void godotConnection.connect()}
            >
              {godotConnection.status === 'checking' ? '检测中…' : '检测连接'}
            </button>
            <GodotConnectionText connection={godotConnection} />
          </div>

          <div className="settings-plugin-row">
            <span className="hint">{godotPluginHint(godotConnection)}</span>
            <button
              type="button"
              className="mini"
              disabled={
                !godotConnection.available ||
                godotConnection.installing ||
                unrealPrefs.godotProjectPath.trim() === ''
              }
              onClick={() => void godotConnection.installPlugin()}
            >
              {godotConnection.installing
                ? '安装中…'
                : godotConnection.plugin?.installed === true
                  ? '重新安装插件'
                  : '安装插件'}
            </button>
          </div>
          {godotConnection.notice !== null && (
            <p className={godotConnection.notice.ok ? 'hint' : 'field-error'}>
              {godotConnection.notice.text}
            </p>
          )}
        </section>
      )}

      <section className="settings-card">
        <div className="settings-item">
          <div className="settings-text">
            <strong>自动连接</strong>
            <span>
              开着就按下面的间隔定时探测 {engineLabel} 编辑器，连上顶部那个标签会变绿。
            </span>
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
    </>
  );

  const modulesSection = (
    <section className="settings-card">
      <div className="settings-item">
        <div className="settings-text">
          <strong>模块</strong>
          <span>
            当前项目面向 {engineLabel}，下面是它能用的模块。关掉只是先从侧边栏藏起来，
            不参与校验和导出，数据还在项目文件里；必需模块关不掉。
          </span>
        </div>
      </div>
      <ul className="settings-module-list">
        {modulesForEngine(engine).map((item) => {
          const on = item.required === true || !disabledModules.includes(item.id);
          return (
            <li key={item.id} className="settings-module-row">
              <span className="settings-module-icon">{item.icon}</span>
              <span className="settings-module-label">{item.label}</span>
              {item.required === true ? (
                <span className="hint">必需</span>
              ) : (
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`启用${item.label}`}
                    onChange={(event) => onToggleModule(item.id, event.target.checked)}
                  />
                  <span className="switch-track" />
                  <span className="switch-label">{on ? '已开启' : '已关闭'}</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const generalSection = (
    <>
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
    </>
  );

  return (
    <div className="editor settings" ref={editorRef}>
      <div className="editor-head">
        <h2>设置</h2>
        <span className="hint">引擎与模块记在项目文件里，其余设置只记在这台机器上</span>
      </div>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${section === item.id ? ' active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => chooseSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-sections">
          {section === 'engine'
            ? engineSection
            : section === 'modules'
              ? modulesSection
              : generalSection}
        </div>
      </div>
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

/** Godot 的连接状态文字 */
function GodotConnectionText({ connection }: { connection: GodotConnection }) {
  if (!connection.available) return <span className="hint">只有桌面版能连编辑器</span>;
  if (connection.status === 'idle') return <span className="hint">还没检测</span>;
  if (connection.status === 'checking') return <span className="hint">检测中…</span>;
  if (connection.status === 'offline') {
    return <span className="field-error">{connection.message || '没连上'}</span>;
  }
  const editor = connection.editor;
  return (
    <span className="hint">
      已连接 {editor?.projectName || '（未命名工程）'}
      {editor !== null ? `（Godot ${editor.engineVersion}）` : ''}
    </span>
  );
}

/** 插件装到哪一步了 */
function godotPluginHint(connection: GodotConnection): string {
  if (!connection.available) return '插件的安装与连接只有桌面版支持';
  if (connection.plugin === null) return '选了工程后这里会显示插件装没装';
  if (!connection.plugin.ok) return connection.plugin.message ?? '读不到插件状态';
  if (connection.plugin.installed !== true) return '插件还没装进这个工程';
  if (connection.plugin.enabled !== true) return '插件已复制进工程，但 project.godot 里还没启用';
  if (connection.plugin.pairing !== true) return '插件已启用：重启一次 Godot 编辑器就能连上';
  return `插件已启用（v${connection.plugin.version ?? '?'}）`;
}
