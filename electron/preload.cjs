/**
 * 预加载脚本：在渲染进程里安全地暴露一小撮桌面能力。
 *
 * contextIsolation 打开的情况下，网页拿不到 Node，只能看到这里明确挂上去的方法。
 * 单文件版没有这些方法，它会改走「启动StoryMaker.bat」起的本地服务。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storymakerDesktop', {
  /** 新建项目：弹保存框选一个 .json 路径，返回路径或 null */
  pickNewProjectPath: (suggestedName) => ipcRenderer.invoke('project:pick-new', suggestedName),

  /** 打开项目：弹选择框，返回 { filePath, content } 或 null */
  pickProject: () => ipcRenderer.invoke('project:pick-open'),

  /** 按路径读回项目内容；读不到返回 null */
  readProject: (filePath) => ipcRenderer.invoke('project:read', filePath),

  /** 按路径写回项目内容（自动保存 / 手动保存） */
  writeProject: (filePath, content) => ipcRenderer.invoke('project:write', filePath, content),

  /** 把二进制（如 xlsx）另存为文件，返回路径或 null */
  exportFile: (suggestedName, data) => ipcRenderer.invoke('file:save-as', suggestedName, data),

  /** 在资源管理器里定位文件 */
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),

  /** 查更新：返回 { status, current, latest?, size?, message? } */
  checkUpdate: () => ipcRenderer.invoke('update:check'),

  /** 下载并校验新 asar；返回 { ok, message? } */
  downloadUpdate: () => ipcRenderer.invoke('update:download'),

  /** 重启并安装：主进程会起一个 bat，退出后替换 app.asar 再拉起自己 */
  applyUpdate: () => ipcRenderer.invoke('update:apply'),

  /** 启动时后台检查到新版会推这个事件；返回取消订阅的函数 */
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },

  /** 找在线的 Unreal 编辑器；返回 { nodes, error? } */
  unrealDiscover: (uprojectPath) => ipcRenderer.invoke('unreal:discover', uprojectPath),

  /** 导入到 Unreal：数据表 / 图片 / 音效 */
  unrealImport: (request) => ipcRenderer.invoke('unreal:import', request),

  /** 导入进度（主进程逐项推进来）；返回取消订阅的函数 */
  unrealImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('unreal:import-progress', listener);
    return () => ipcRenderer.removeListener('unreal:import-progress', listener);
  },

  /** 挑 .uproject 文件；取消返回 null */
  unrealPickUproject: () => ipcRenderer.invoke('unreal:pick-uproject'),

  /** 挑素材文件夹；取消返回 null */
  unrealPickAssetFolder: () => ipcRenderer.invoke('unreal:pick-asset-folder'),

  /** 列出素材文件夹里的图片 / 音效文件 */
  unrealListAssets: (folder) => ipcRenderer.invoke('unreal:list-assets', folder),

  /** 选一个文件复制进素材文件夹，按 ID 重命名 */
  unrealUploadAsset: (request) => ipcRenderer.invoke('unreal:upload-asset', request),

  /** 删掉一个素材文件 */
  unrealRemoveAsset: (filePath) => ipcRenderer.invoke('unreal:remove-asset', filePath),

  /** 条目改了 ID：把素材文件跟着改名 */
  unrealRenameAsset: (request) => ipcRenderer.invoke('unreal:rename-asset', request),

  /** 读素材内容（预览图 / 播放音频） */
  unrealReadAsset: (filePath) => ipcRenderer.invoke('unreal:read-asset', filePath),
});
