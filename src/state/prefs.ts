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
