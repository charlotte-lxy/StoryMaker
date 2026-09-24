/**
 * 宿主能力：界面之外唯一负责"读写磁盘上的项目文件"的那一层。
 *
 * 项目数据只存在于用户选定的 .json 项目文件里——本机不缓存项目内容，
 * 这里只负责按路径读写它，外加记住"上一次开启的文件路径"。
 *
 * 两种宿主：
 *   - 桌面版：Electron 的 preload 注入 window.storymakerDesktop
 *   - 本地服务版：启动StoryMaker.bat 起的本地服务，往页面里注入 window.__STORYMAKER_SERVER__
 *
 * 两者都没有（比如直接双击 index.html、或把 dist 放到内网服务器上）时返回 undefined，
 * 界面会停在门槛页，引导用户改用 .bat 启动。
 */

import { loadSessionPath, saveSessionPath } from '../state/prefs';

export interface PickedProject {
  filePath: string;
  content: string;
}

export interface HostApi {
  kind: 'desktop' | 'server';
  /** 上一次开启的项目文件路径；没有则 null */
  lastProjectPath: () => Promise<string | null>;
  /** 记住 / 忘掉当前项目文件路径 */
  rememberProjectPath: (filePath: string | null) => Promise<void>;
  /** 新建：弹保存框选一个 .json 路径（不写内容）；取消返回 null */
  pickNewProjectPath: (suggestedName: string) => Promise<string | null>;
  /** 打开：弹选择框并读回内容；取消返回 null */
  pickProject: () => Promise<PickedProject | null>;
  /** 按路径读回项目内容；文件不在或读不了返回 null */
  readProject: (filePath: string) => Promise<string | null>;
  /** 把内容写进指定路径 */
  writeProject: (filePath: string, content: string) => Promise<void>;
  /** 导出二进制（xlsx 等）：弹保存框；取消返回 null */
  exportFile: (suggestedName: string, data: ArrayBuffer) => Promise<string | null>;
  /** 在文件管理器里定位文件 */
  revealFile: (filePath: string) => Promise<void>;
}

/** Electron 主进程通过 preload 暴露的接口 */
export interface DesktopBridge {
  pickNewProjectPath: (suggestedName: string) => Promise<string | null>;
  pickProject: () => Promise<PickedProject | null>;
  readProject: (filePath: string) => Promise<string | null>;
  writeProject: (filePath: string, content: string) => Promise<void>;
  exportFile: (suggestedName: string, data: ArrayBuffer) => Promise<string | null>;
  revealFile: (filePath: string) => Promise<void>;
}

/** 本地服务版：由服务端注入的一次性令牌，防止别的网页乱调本地接口 */
interface ServerBridge {
  token: string;
}

declare global {
  interface Window {
    storymakerDesktop?: DesktopBridge;
    __STORYMAKER_SERVER__?: ServerBridge;
  }
}

/** 从完整路径里取出文件名，用于界面提示 */
export function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

const TOKEN_HEADER = 'X-StoryMaker-Token';
const PATH_HEADER = 'X-StoryMaker-Path';

/** ArrayBuffer → base64：本地服务用文本 HTTP 传二进制，比 multipart 省事 */
function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return window.btoa(binary);
}

function serverHost(token: string): HostApi {
  const query = (filePath: string): string => `?path=${encodeURIComponent(filePath)}`;

  async function post(path: string, body?: BodyInit, extra?: Record<string, string>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: token, ...extra },
      body,
    });
    // 令牌不对、或者服务只允许操作它自己记住的那个文件
    if (response.status === 403) throw new Error('本地服务拒绝了这次请求，请重新用「启动StoryMaker.bat」打开');
    return response;
  }

  async function pickPath(path: string): Promise<string | null> {
    const response = await post(path);
    if (response.status === 204) return null;
    const parsed = (await response.json()) as { filePath?: unknown };
    return typeof parsed.filePath === 'string' && parsed.filePath !== '' ? parsed.filePath : null;
  }

  return {
    kind: 'server',

    lastProjectPath: async () => {
      const response = await post('/api/last-path');
      const parsed = (await response.json()) as { filePath?: unknown };
      return typeof parsed.filePath === 'string' && parsed.filePath !== '' ? parsed.filePath : null;
    },

    rememberProjectPath: async (filePath) => {
      await post(filePath === null ? '/api/forget' : `/api/remember${query(filePath)}`);
    },

    pickNewProjectPath: (suggestedName) =>
      pickPath(`/api/pick-new?suggestedName=${encodeURIComponent(suggestedName)}`),

    pickProject: async () => {
      const response = await post('/api/pick-open');
      if (response.status === 204) return null;
      const header = response.headers.get(PATH_HEADER);
      if (header === null) throw new Error('本地服务返回的项目路径读不出来');
      return { filePath: decodeURIComponent(header), content: await response.text() };
    },

    readProject: async (filePath) => {
      const response = await post(`/api/read${query(filePath)}`);
      return response.ok ? await response.text() : null;
    },

    writeProject: async (filePath, content) => {
      const response = await post(`/api/write${query(filePath)}`, content, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      if (!response.ok) throw new Error('写入项目文件失败');
    },

    exportFile: async (suggestedName, data) => {
      const response = await post(
        `/api/export?suggestedName=${encodeURIComponent(suggestedName)}`,
        toBase64(data),
      );
      if (response.status === 204) return null;
      const parsed = (await response.json()) as { filePath?: unknown };
      return typeof parsed.filePath === 'string' ? parsed.filePath : null;
    },

    revealFile: async (filePath) => {
      await post(`/api/reveal${query(filePath)}`);
    },
  };
}

function desktopHost(bridge: DesktopBridge): HostApi {
  return {
    kind: 'desktop',
    // 桌面版把"上次的项目路径"记在本机 localStorage 里，只记路径，不记项目内容
    lastProjectPath: async () => loadSessionPath(),
    rememberProjectPath: async (filePath) => saveSessionPath(filePath),
    pickNewProjectPath: (suggestedName) => bridge.pickNewProjectPath(suggestedName),
    pickProject: () => bridge.pickProject(),
    readProject: (filePath) => bridge.readProject(filePath),
    writeProject: (filePath, content) => bridge.writeProject(filePath, content),
    exportFile: (suggestedName, data) => bridge.exportFile(suggestedName, data),
    revealFile: (filePath) => bridge.revealFile(filePath),
  };
}

/**
 * 当前环境能提供哪种宿主；每次调用都重新看一遍全局对象，
 * 这样测试可以先装好假宿主再渲染界面。
 */
export function getHost(): HostApi | undefined {
  if (typeof window === 'undefined') return undefined;
  if (window.storymakerDesktop !== undefined) return desktopHost(window.storymakerDesktop);
  const server = window.__STORYMAKER_SERVER__;
  if (server !== undefined && typeof server.token === 'string') return serverHost(server.token);
  return undefined;
}
