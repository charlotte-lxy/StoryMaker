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

/** 保存项目：弹保存框，选一个 .json 文件 */
ipcMain.handle('project:save', async (_event, payload) => {
  const { content, suggestedName, currentPath } = payload;

  let target = currentPath ?? null;
  if (target === null) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存项目',
      defaultPath: `${suggestedName || 'StoryMaker项目'}.json`,
      filters: [{ name: 'StoryMaker 项目', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }

  await writeFile(target, content, 'utf8');
  return { canceled: false, filePath: target };
});

/** 打开项目：弹选择框，读回 JSON 文本 */
ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开项目',
    properties: ['openFile'],
    filters: [{ name: 'StoryMaker 项目', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const filePath = result.filePaths[0];
  const content = await readFile(filePath, 'utf8');
  return { canceled: false, filePath, content };
});

/** 按路径直接读回项目：启动时自动打开上次的项目，不再弹选择框 */
ipcMain.handle('project:read', async (_event, filePath) => {
  try {
    const content = await readFile(filePath, 'utf8');
    return { canceled: false, filePath, content };
  } catch {
    // 文件被移走、改名或删掉：交给前端自己回退提示
    return { canceled: true };
  }
});

/** 导出文件（Excel 等）：让策划自己选位置 */
ipcMain.handle('file:save-as', async (_event, payload) => {
  const { suggestedName, data } = payload;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出',
    defaultPath: suggestedName,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  await writeFile(result.filePath, Buffer.from(data), undefined);
  return { canceled: false, filePath: result.filePath };
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
