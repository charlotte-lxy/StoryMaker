/**
 * 桌面能力的前端封装。
 *
 * 同一个前端要跑在两种环境里：
 *   - 桌面应用（Electron）：走主进程读写本地文件，数据是磁盘上看得见的 .json
 *   - 浏览器 / 单文件 HTML：退回 localStorage + 浏览器下载
 *
 * 通过 preload 暴露的 window.storymakerDesktop 判断当前是哪一种。
 */

export interface SaveResult {
  canceled: boolean;
  filePath?: string;
}

export interface OpenResult {
  canceled: boolean;
  filePath?: string;
  content?: string;
}

interface DesktopApi {
  isDesktop: true;
  saveProject: (payload: {
    content: string;
    suggestedName: string;
    currentPath: string | null;
  }) => Promise<SaveResult>;
  openProject: () => Promise<OpenResult>;
  /** 按已知路径直接读回项目，用于启动时自动打开上次的项目 */
  readProject: (filePath: string) => Promise<OpenResult>;
  saveFileAs: (payload: { suggestedName: string; data: ArrayBuffer }) => Promise<SaveResult>;
  revealFile: (filePath: string) => Promise<boolean>;
}

declare global {
  interface Window {
    storymakerDesktop?: DesktopApi;
  }
}

export const desktop: DesktopApi | undefined =
  typeof window === 'undefined' ? undefined : window.storymakerDesktop;

export const isDesktop = desktop !== undefined;

/** 从完整路径里取出文件名，用于界面提示 */
export function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}
