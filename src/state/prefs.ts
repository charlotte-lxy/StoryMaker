/**
 * 界面设置与「上次打开的项目」的记忆。
 *
 * 项目里要跟着走的那部分界面配置（主题）存在项目文件的 `ui` 里（见 core/types.ts），
 * 这里的 localStorage 只是本机的一份：门槛页、还没打开项目时用，也用来记自动保存开关。
 */

import type { EngineKind, ThemeName } from '../core/types';

export type { EngineKind, ThemeName };

export interface Settings {
  /** 编辑后是否自动保存 */
  autoSave: boolean;
  theme: ThemeName;
}

export const DEFAULT_SETTINGS: Settings = { autoSave: true, theme: 'light' };

const SETTINGS_KEY = 'storymaker.settings.v1';
const SESSION_KEY = 'storymaker.session.v1';
const LAYOUT_KEY = 'storymaker.story-layout.v1';

/**
 * 剧情模块的布局（左侧合并面板的宽度）。
 *
 * 换台机器打开同一个项目时，窗口大小本来就不一样，所以这份尺寸只记在本机，
 * 不进项目文件；老版本存的分栏比例 `storymaker.story-split.v1` 与预览占比不再读取。
 */
export interface StoryLayout {
  /** 合并面板（预览 + 章节 / 段落 + 流程图）的宽度，单位 px */
  outlineWidth: number;
}

export const DEFAULT_STORY_LAYOUT: StoryLayout = { outlineWidth: 560 };

/** 合并面板再窄流程图就没法看了 */
export const OUTLINE_WIDTH_MIN = 360;

/** 拖到最宽时给右边的编辑区留多少（够放下对话列表与行编辑），剩下的都归左侧面板 */
export const OUTLINE_WIDTH_RESERVE = 560;

/** 面板允许多宽：不写死上限，跟着窗口宽度走（预览要能拖多大就拖多大） */
export function outlineWidthLimit(): number {
  const viewport = typeof window === 'undefined' ? 0 : window.innerWidth;
  return Math.max(OUTLINE_WIDTH_MIN, Math.round(viewport - OUTLINE_WIDTH_RESERVE));
}

export function clampOutlineWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_STORY_LAYOUT.outlineWidth;
  return Math.round(Math.min(outlineWidthLimit(), Math.max(OUTLINE_WIDTH_MIN, width)));
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    // 本地数据损坏时当成没存过，不让界面白屏
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储写满时不要让界面崩掉
  }
}

/** 读取设置；缺字段、值不合法都退回默认值（老版本存下的数据也走这条路） */
export function loadSettings(): Settings {
  const parsed = readJson(SETTINGS_KEY);
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };

  const raw = parsed as Partial<Settings>;
  return {
    autoSave: typeof raw.autoSave === 'boolean' ? raw.autoSave : DEFAULT_SETTINGS.autoSave,
    theme: raw.theme === 'dark' ? 'dark' : DEFAULT_SETTINGS.theme,
  };
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, settings);
}

/** 上次打开 / 保存到的项目文件路径；浏览器模式下没有文件，恒为 null */
export function loadSessionPath(): string | null {
  const parsed = readJson(SESSION_KEY);
  if (parsed === null || typeof parsed !== 'object') return null;

  const filePath = (parsed as { projectPath?: unknown }).projectPath;
  return typeof filePath === 'string' && filePath !== '' ? filePath : null;
}

export function saveSessionPath(projectPath: string | null): void {
  writeJson(SESSION_KEY, { projectPath });
}

/** 剧情模块合并面板的宽度；没存过、或存坏了都用默认值 */
export function loadStoryLayout(): StoryLayout {
  const parsed = readJson(LAYOUT_KEY);
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_STORY_LAYOUT };

  const raw = parsed as Partial<StoryLayout>;
  return { outlineWidth: clampOutlineWidth(Number(raw.outlineWidth)) };
}

export function saveStoryLayout(layout: StoryLayout): void {
  writeJson(LAYOUT_KEY, { outlineWidth: clampOutlineWidth(layout.outlineWidth) });
}

const COLLAB_KEY = 'storymaker.collab.v1';

/**
 * 协作服务端的默认地址。
 *
 * 默认就填这台常驻机，策划第一次打开不用问人就知道该填什么；换机器在界面上改一下，
 * 改完记在本机。存的是"设置"不是项目数据，所以放 localStorage 不违反
 * 「项目内容只有一份」那条原则。
 */
export const DEFAULT_COLLAB_URL = 'ws://192.168.1.20:1999';

/** 五个标记颜色：红黄蓝绿紫。取中间调，深浅两套主题下都看得清 */
export const COLLAB_COLORS = [
  { key: 'red', label: '红', value: '#e5484d' },
  { key: 'yellow', label: '黄', value: '#c99a06' },
  { key: 'blue', label: '蓝', value: '#3b6ef5' },
  { key: 'green', label: '绿', value: '#2f9e63' },
  { key: 'purple', label: '紫', value: '#8e4ec6' },
] as const;

export type CollabColor = (typeof COLLAB_COLORS)[number]['key'];

export function collabColorValue(key: string): string {
  const found = COLLAB_COLORS.find((item) => item.key === key);
  return found === undefined ? COLLAB_COLORS[0].value : found.value;
}

export interface CollabPrefs {
  url: string;
  /** 上次是连着的时候记住它，下次打开自动连；连不上也不影响编辑，只是状态显示离线 */
  autoConnect: boolean;
  /** 协作用户名；空着就显示「未命名用户」 */
  name: string;
  color: CollabColor;
  /**
   * 本机在协作里的身份，持久化下来：重连还是同一个人，
   * 名字和颜色不会变，别人看到的名单也不会因为重连凭空多出一个人。
   */
  clientId: string;
}

export function loadCollabPrefs(): CollabPrefs {
  const parsed = readJson(COLLAB_KEY);
  if (parsed === null || typeof parsed !== 'object') {
    return { url: DEFAULT_COLLAB_URL, autoConnect: false, name: '', color: 'red', clientId: '' };
  }

  const raw = parsed as Partial<CollabPrefs>;
  const url =
    typeof raw.url === 'string' && raw.url.trim() !== '' ? raw.url.trim() : DEFAULT_COLLAB_URL;
  const color = COLLAB_COLORS.some((item) => item.key === raw.color)
    ? (raw.color as CollabColor)
    : 'red';

  return {
    url,
    autoConnect: raw.autoConnect === true,
    name: typeof raw.name === 'string' ? raw.name : '',
    color,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : '',
  };
}

export function saveCollabPrefs(prefs: CollabPrefs): void {
  writeJson(COLLAB_KEY, {
    url: prefs.url,
    autoConnect: prefs.autoConnect,
    name: prefs.name,
    color: prefs.color,
    clientId: prefs.clientId,
  });
}

const UNREAL_KEY = 'storymaker.unreal.v1';

/**
 * 「连接引擎」的本机配置。
 *
 * 存的是这台机器的路径与连接习惯，不是项目内容，所以放 localStorage：
 * 换台机器打开同一个项目，路径本来就该不一样。
 * 名字沿用了 UnrealPrefs，但它现在同时管 Unreal 和 Godot。
 */
export interface UnrealPrefs {
  /**
   * 上次在设置里选的引擎。
   *
   * 只当新建项目时的默认值；打开已有项目后，以项目文件里的 `engine` 为准（那个才决定侧边栏）。
   */
  engine: EngineKind;
  /** Unreal 项目文件（.uproject）的完整路径；空串表示还没配 */
  uprojectPath: string;
  /** Godot 工程文件（project.godot）的完整路径；空串表示还没配 */
  godotProjectPath: string;
  /** 本地素材文件夹：png / wav 丢在里面，文件名就是图片 / 音效 ID */
  assetFolder: string;
  /** 打开软件后自动定时探测编辑器；关掉就只能手动点「检测连接」 */
  autoConnect: boolean;
  /** 自动探测的间隔（秒）；太小没意义，最小按 1 秒算 */
  connectIntervalSec: number;
}

/** 自动检测的默认间隔：5 秒一次 */
export const DEFAULT_CONNECT_INTERVAL_SEC = 5;

export const DEFAULT_UNREAL_PREFS: UnrealPrefs = {
  engine: 'unreal',
  uprojectPath: '',
  godotProjectPath: '',
  assetFolder: '',
  autoConnect: true,
  connectIntervalSec: DEFAULT_CONNECT_INTERVAL_SEC,
};

export function loadUnrealPrefs(): UnrealPrefs {
  const parsed = readJson(UNREAL_KEY);
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_UNREAL_PREFS };

  const raw = parsed as Partial<UnrealPrefs>;
  const interval = Number(raw.connectIntervalSec);
  return {
    engine: raw.engine === 'godot' ? 'godot' : 'unreal',
    uprojectPath: typeof raw.uprojectPath === 'string' ? raw.uprojectPath : '',
    godotProjectPath: typeof raw.godotProjectPath === 'string' ? raw.godotProjectPath : '',
    assetFolder: typeof raw.assetFolder === 'string' ? raw.assetFolder : '',
    autoConnect: typeof raw.autoConnect === 'boolean' ? raw.autoConnect : DEFAULT_UNREAL_PREFS.autoConnect,
    connectIntervalSec:
      Number.isFinite(interval) && interval >= 1
        ? Math.min(120, Math.round(interval))
        : DEFAULT_CONNECT_INTERVAL_SEC,
  };
}

export function saveUnrealPrefs(prefs: UnrealPrefs): void {
  writeJson(UNREAL_KEY, {
    engine: prefs.engine,
    uprojectPath: prefs.uprojectPath,
    godotProjectPath: prefs.godotProjectPath,
    assetFolder: prefs.assetFolder,
    autoConnect: prefs.autoConnect,
    connectIntervalSec: prefs.connectIntervalSec,
  });
}
