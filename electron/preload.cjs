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
});
