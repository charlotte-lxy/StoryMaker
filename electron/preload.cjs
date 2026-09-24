/**
 * 预加载脚本：在渲染进程里安全地暴露一小撮桌面能力。
 *
 * contextIsolation 打开的情况下，网页拿不到 Node，只能看到这里明确挂上去的方法。
 * 浏览器版没有这些方法，前端会回退到 localStorage / 浏览器下载。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storymakerDesktop', {
  /** 前端靠这个标志判断"我在桌面应用里"，而不是浏览器里 */
  isDesktop: true,

  /** 保存项目 JSON；currentPath 为空时弹保存框 */
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),

  /** 打开项目 JSON，返回 { filePath, content } */
  openProject: () => ipcRenderer.invoke('project:open'),

  /** 按已知路径读回项目（启动时自动打开上次的项目） */
  readProject: (filePath) => ipcRenderer.invoke('project:read', filePath),

  /** 把二进制（如 xlsx）另存为文件 */
  saveFileAs: (payload) => ipcRenderer.invoke('file:save-as', payload),

  /** 在资源管理器里定位文件 */
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
});
