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

/** 某一版的更新日志 */
export interface UpdateNote {
  version: string;
  items: string[];
}

/** 自动更新的检查结果 */
export interface UpdateCheckResult {
  status: 'latest' | 'available' | 'error' | 'unsupported';
  current: string;
  latest?: string;
  /** 新版本 app.asar 的字节数，用来在界面上显示下载大小 */
  size?: number;
  /** 当前版本之后、最新版本之前的更新日志（新→旧） */
  notes?: UpdateNote[];
  message?: string;
}

export interface UpdateDownloadResult {
  ok: boolean;
  message?: string;
}

export interface UpdateNotice {
  current: string;
  latest: string;
  size: number;
  /** 从当前版本到最新版本的更新日志；没取到时是空数组 */
  notes?: UpdateNote[];
}

/** 一个在线的 Unreal 编辑器（Remote Execution 发现到的节点） */
export interface UnrealNodeInfo {
  id: string;
  user: string;
  machine: string;
  engineVersion: string;
  engineRoot: string;
  projectRoot: string;
  /** 项目名，用来确认连的是这个工程而不是别的 */
  projectName: string;
}

/** 一条导入结果：一张表 / 一张图 / 一条音效 */
export interface UnrealImportItem {
  kind: 'table' | 'image' | 'sound';
  label: string;
  ok: boolean;
  detail: string;
}

/** 要导的一个素材：ID 给界面显示，sourcePath 是本地文件 */
export interface UnrealImportAsset {
  /** 条目 uid，导入成功后在记录里按它登记 */
  ownerUid: string;
  id: string;
  assetPath: string;
  sourcePath: string;
  /**
   * 条目改过 ID 时 UE 里旧资产的路径：导入前先把它改名到新路径，
   * 否则会变成「新建一个 + 旧资产残留」。
   */
  previousAssetPath?: string;
}

export interface UnrealImportRequest {
  /** 目标 Unreal 项目的 .uproject 路径 */
  uprojectPath: string;
  /** 这个请求里给什么就导什么；增量时界面只放变化项 */
  plan: {
    tables: Array<{ label: string; assetPath: string; csvText: string }>;
    images: UnrealImportAsset[];
    sounds: UnrealImportAsset[];
  };
}

export interface UnrealImportReport {
  ok: boolean;
  message?: string;
  /** 素材阶段有失败、因而没导数据表 */
  stopped: boolean;
  /** 逐项结果 */
  items: UnrealImportItem[];
  /** 素材阶段成功导入的条目 uid，用来更新「已导入」标记 */
  importedOwnerUids: string[];
  counts: { tables: number; images: number; sounds: number };
}

/** 导入进度：界面按它画进度条 */
export interface UnrealImportProgress {
  phase: 'assets' | 'tables';
  /** 当前第几项（从 1 开始） */
  current: number;
  total: number;
  /** 正在导的文件名 / 表名 */
  label: string;
  status: 'running' | 'ok' | 'failed';
}

/**
 * 素材文件夹里的一个文件。
 *
 * `baseName` 不含扩展名，界面拿它和图片 ID / 音效 ID 对。
 */
export interface AssetFileInfo {
  filePath: string;
  fileName: string;
  baseName: string;
  kind: 'image' | 'sound';
  /** 字节数，增量判定用 */
  size: number;
  /** 修改时间（毫秒），增量判定用 */
  mtimeMs: number;
}

export interface AssetListResult {
  ok: boolean;
  files: AssetFileInfo[];
  message?: string;
}

export interface AssetUploadResult {
  ok: boolean;
  /** 用户在选择框里点了取消 */
  canceled?: boolean;
  filePath?: string;
  message?: string;
}

export interface AssetReadResult {
  ok: boolean;
  /** 文件二进制；成功时一定有 */
  data?: Uint8Array;
  message?: string;
}

/**
 * 「导入到 Unreal」能力：只有桌面版有（要开本机 UDP/TCP 去连编辑器）。
 * 网页版 / 本地服务版拿不到，界面显示成不支持。
 */
export interface UnrealApi {
  /** 找在线的编辑器；连不上时返回空列表并带一条 error */
  discover: (uprojectPath: string) => Promise<{ nodes: UnrealNodeInfo[]; error?: string }>;
  /** 真正导入：连上编辑器、跑脚本、把结果拿回来 */
  runImport: (request: UnrealImportRequest) => Promise<UnrealImportReport>;
  /** 订阅导入进度；返回取消订阅的函数 */
  onImportProgress: (listener: (progress: UnrealImportProgress) => void) => () => void;
  /** 挑 .uproject 文件；取消返回 null */
  pickUproject: () => Promise<string | null>;
  /** 挑素材文件夹；取消返回 null */
  pickAssetFolder: () => Promise<string | null>;
  /** 列素材文件夹里的图片 / 音效（递归，只给文件名与路径） */
  listAssets: (folder: string) => Promise<AssetListResult>;
  /** 选一个文件复制进素材文件夹并按 ID 重命名；`replace` 会先删掉同 ID 的旧文件 */
  uploadAsset: (request: {
    folder: string;
    id: string;
    kind: 'image' | 'sound';
    replace?: boolean;
  }) => Promise<AssetUploadResult>;
  /** 删掉一个素材文件 */
  removeAsset: (filePath: string) => Promise<{ ok: boolean; message?: string }>;
  /** 条目改了 ID：把素材文件跟着改名 */
  renameAsset: (request: {
    folder: string;
    oldId: string;
    newId: string;
    kind: 'image' | 'sound';
  }) => Promise<{ ok: boolean; filePath?: string; message?: string }>;
  /** 读素材内容，用于预览图和音频播放 */
  readAsset: (filePath: string) => Promise<AssetReadResult>;
}

/**
 * 自动更新能力：只有打包后的桌面版有。
 * 网页版 / 本地服务版拿不到它，界面上显示成「当前环境不支持」。
 */
export interface UpdateApi {
  check: () => Promise<UpdateCheckResult>;
  download: () => Promise<UpdateDownloadResult>;
  /** 重启并安装：主进程会退出，替换 app.asar 后再拉起来 */
  apply: () => Promise<UpdateDownloadResult>;
  /** 启动时后台检查到新版会推事件；返回取消订阅的函数 */
  onAvailable: (listener: (notice: UpdateNotice) => void) => () => void;
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
  /** 读项目文件旁边的协作元数据（<项目>.sync）；没有或读不了返回 null */
  readSidecar: (filePath: string) => Promise<string | null>;
  /** 写协作元数据：存的是"上次同步到什么状态"，用来算离线期间改了什么 */
  writeSidecar: (filePath: string, content: string) => Promise<void>;
  /** 把一份内容另存为备份（首次对账舍弃某一份时用）。backupPath 是目标文件的完整路径 */
  writeBackup: (backupPath: string, content: string) => Promise<void>;
  /** 导出二进制（xlsx 等）：弹保存框；取消返回 null */
  exportFile: (suggestedName: string, data: ArrayBuffer) => Promise<string | null>;
  /** 在文件管理器里定位文件 */
  revealFile: (filePath: string) => Promise<void>;
  /** 自动更新；没有这个能力的宿主是 undefined */
  update?: UpdateApi;
  /** 导入到 Unreal；没有这个能力的宿主（网页版 / 本地服务版）是 undefined */
  unreal?: UnrealApi;
}

/** Electron 主进程通过 preload 暴露的接口 */
export interface DesktopBridge {
  pickNewProjectPath: (suggestedName: string) => Promise<string | null>;
  pickProject: () => Promise<PickedProject | null>;
  readProject: (filePath: string) => Promise<string | null>;
  writeProject: (filePath: string, content: string) => Promise<void>;
  exportFile: (suggestedName: string, data: ArrayBuffer) => Promise<string | null>;
  revealFile: (filePath: string) => Promise<void>;
  /** 下面四个只在打包后的桌面版里有（测试用假宿主可以不给） */
  checkUpdate?: () => Promise<UpdateCheckResult>;
  downloadUpdate?: () => Promise<UpdateDownloadResult>;
  applyUpdate?: () => Promise<UpdateDownloadResult>;
  onUpdateAvailable?: (listener: (notice: UpdateNotice) => void) => () => void;
  /** 导入到 Unreal；老版本 preload 没有这一组 */
  unrealDiscover?: (uprojectPath: string) => Promise<{ nodes: UnrealNodeInfo[]; error?: string }>;
  unrealImport?: (request: UnrealImportRequest) => Promise<UnrealImportReport>;
  unrealImportProgress?: (
    listener: (progress: UnrealImportProgress) => void,
  ) => () => void;
  unrealPickUproject?: () => Promise<string | null>;
  unrealPickAssetFolder?: () => Promise<string | null>;
  unrealListAssets?: (folder: string) => Promise<AssetListResult>;
  unrealUploadAsset?: (request: {
    folder: string;
    id: string;
    kind: 'image' | 'sound';
    replace?: boolean;
  }) => Promise<AssetUploadResult>;
  unrealRemoveAsset?: (filePath: string) => Promise<{ ok: boolean; message?: string }>;
  unrealRenameAsset?: (request: {
    folder: string;
    oldId: string;
    newId: string;
    kind: 'image' | 'sound';
  }) => Promise<{ ok: boolean; filePath?: string; message?: string }>;
  unrealReadAsset?: (filePath: string) => Promise<AssetReadResult>;
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

/**
 * 协作元数据的路径：就放在项目文件旁边，名字后面加 .sync。
 *
 * 为什么不塞进项目文件本身——那会污染策划的数据、也会被导出流程牵连；
 * 为什么不塞进 localStorage——那又会绕过本地服务"只碰它记住的那个文件"的边界。
 */
export function sidecarPath(filePath: string): string {
  return `${filePath}.sync`;
}

/**
 * 备份文件的路径：<项目>.backup-<年月日>-<时分秒>.json，和项目文件同目录。
 *
 * 带时间戳是为了每次对账都留一份——万一连选错两次，前一次还找得回来。
 */
export function backupPath(filePath: string, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${filePath}.backup-${stamp}.json`;
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

    readSidecar: async (filePath) => {
      const response = await post(`/api/read${query(sidecarPath(filePath))}`);
      return response.ok ? await response.text() : null;
    },

    writeSidecar: async (filePath, content) => {
      const response = await post(`/api/write${query(sidecarPath(filePath))}`, content, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      if (!response.ok) throw new Error('写入协作元数据失败');
    },

    writeBackup: async (backupTarget, content) => {
      const response = await post(`/api/write${query(backupTarget)}`, content, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      if (!response.ok) throw new Error('备份文件写不进去');
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
  // 老版本 preload 或者测试用的假宿主可能没有这几个方法
  const update: UpdateApi | undefined =
    bridge.checkUpdate !== undefined &&
    bridge.downloadUpdate !== undefined &&
    bridge.applyUpdate !== undefined
      ? {
          check: () => bridge.checkUpdate!(),
          download: () => bridge.downloadUpdate!(),
          apply: () => bridge.applyUpdate!(),
          onAvailable: (listener) => bridge.onUpdateAvailable?.(listener) ?? (() => {}),
        }
      : undefined;

  const unreal: UnrealApi | undefined =
    bridge.unrealDiscover !== undefined &&
    bridge.unrealImport !== undefined &&
    bridge.unrealImportProgress !== undefined &&
    bridge.unrealPickUproject !== undefined &&
    bridge.unrealPickAssetFolder !== undefined &&
    bridge.unrealListAssets !== undefined &&
    bridge.unrealUploadAsset !== undefined &&
    bridge.unrealRemoveAsset !== undefined &&
    bridge.unrealRenameAsset !== undefined &&
    bridge.unrealReadAsset !== undefined
      ? {
          discover: (uprojectPath) => bridge.unrealDiscover!(uprojectPath),
          runImport: (request) => bridge.unrealImport!(request),
          onImportProgress: (listener) => bridge.unrealImportProgress!(listener),
          pickUproject: () => bridge.unrealPickUproject!(),
          pickAssetFolder: () => bridge.unrealPickAssetFolder!(),
          listAssets: (folder) => bridge.unrealListAssets!(folder),
          uploadAsset: (request) => bridge.unrealUploadAsset!(request),
          removeAsset: (filePath) => bridge.unrealRemoveAsset!(filePath),
          renameAsset: (request) => bridge.unrealRenameAsset!(request),
          readAsset: (filePath) => bridge.unrealReadAsset!(filePath),
        }
      : undefined;

  return {
    kind: 'desktop',
    // 桌面版把"上次的项目路径"记在本机 localStorage 里，只记路径，不记项目内容
    lastProjectPath: async () => loadSessionPath(),
    rememberProjectPath: async (filePath) => saveSessionPath(filePath),
    pickNewProjectPath: (suggestedName) => bridge.pickNewProjectPath(suggestedName),
    pickProject: () => bridge.pickProject(),
    readProject: (filePath) => bridge.readProject(filePath),
    writeProject: (filePath, content) => bridge.writeProject(filePath, content),
    // 桌面版的主进程本来就按路径读写，.sync 直接搭车
    readSidecar: (filePath) => bridge.readProject(sidecarPath(filePath)),
    writeSidecar: (filePath, content) => bridge.writeProject(sidecarPath(filePath), content),
    writeBackup: (backupTarget, content) => bridge.writeProject(backupTarget, content),
    exportFile: (suggestedName, data) => bridge.exportFile(suggestedName, data),
    revealFile: (filePath) => bridge.revealFile(filePath),
    update,
    unreal,
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
