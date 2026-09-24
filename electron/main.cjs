/**
 * Electron 主进程。
 *
 * 加载构建好的 dist/ 前端，并充当"本地文件"的读写代理：
 * 渲染进程想保存/打开项目时，通过 preload 暴露的接口走到这里来。
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

/** 开发模式直接连 Vite，正式模式读打包进来的 dist */
const isDev = !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 680,
    title: 'StoryMaker',
    backgroundColor: '#f4f6fa',
    // 窗口和任务栏图标；打包后 exe 自身的图标由 electron-builder 的 win.icon 决定
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 去掉默认菜单栏，策划用不到
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 新建项目：只挑一个 .json 路径，内容由渲染进程随后写进来。
 * 取消返回 null。
 */
ipcMain.handle('project:pick-new', async (_event, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '新建项目文件',
    defaultPath: `${suggestedName || 'StoryMaker项目'}.json`,
    filters: [{ name: 'StoryMaker 项目', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

/** 打开项目：弹选择框，返回路径与内容；取消返回 null */
ipcMain.handle('project:pick-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开项目文件',
    properties: ['openFile'],
    filters: [{ name: 'StoryMaker 项目', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const content = await readFile(filePath, 'utf8');
    return { filePath, content };
  } catch {
    return null;
  }
});

/** 按路径读回项目；读不到返回 null（文件被移走、删掉、被占用等） */
ipcMain.handle('project:read', async (_event, filePath) => {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
});

/** 按路径写回项目：自动保存和手动保存都走这里，不再弹框 */
ipcMain.handle('project:write', async (_event, filePath, content) => {
  await writeFile(filePath, content, 'utf8');
  return true;
});

/** 导出文件（Excel 等）：让策划自己选位置；取消返回 null */
ipcMain.handle('file:save-as', async (_event, suggestedName, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出',
    defaultPath: suggestedName,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, Buffer.from(data), undefined);
  return result.filePath;
});

/** 在文件管理器里定位文件，方便策划找到刚导出的东西 */
ipcMain.handle('shell:reveal', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
