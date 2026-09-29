/**
 * 界面设置与「上次打开的项目」的记忆。
 *
 * 都存在本机 localStorage 里，不写进项目文件——项目文件是要发给同事、要跟着
 * 版本库走的，不该带上别人的界面偏好和磁盘路径。
 */

export type ThemeName = 'light' | 'dark';

export interface Settings {
  /** 编辑后是否自动保存 */
  autoSave: boolean;
  theme: ThemeName;
}

export const DEFAULT_SETTINGS: Settings = { autoSave: true, theme: 'light' };

const SETTINGS_KEY = 'storymaker.settings.v1';
const SESSION_KEY = 'storymaker.session.v1';
const SPLIT_KEY = 'storymaker.story-split.v1';

/** 剧情模块左右分栏的默认宽度：流程图和对话列表各一半 */
export const DEFAULT_STORY_SPLIT = 0.5;

/** 分栏比例限制在这个区间里，免得某一侧被拖到看不见 */
export function clampStorySplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_STORY_SPLIT;
  return Math.min(0.85, Math.max(0.15, ratio));
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

/** 剧情模块左右分栏的比例；拖动分隔线后记住，下次打开还是这个宽度 */
export function loadStorySplit(): number {
  const parsed = readJson(SPLIT_KEY);
  if (parsed === null || typeof parsed !== 'object') return DEFAULT_STORY_SPLIT;

  const ratio = (parsed as { ratio?: unknown }).ratio;
  return typeof ratio === 'number' ? clampStorySplit(ratio) : DEFAULT_STORY_SPLIT;
}

export function saveStorySplit(ratio: number): void {
  writeJson(SPLIT_KEY, { ratio: clampStorySplit(ratio) });
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
