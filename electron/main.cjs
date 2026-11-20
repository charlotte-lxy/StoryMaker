/**
 * Electron 主进程。
 *
 * 加载构建好的 dist/ 前端，并充当"本地文件"的读写代理：
 * 渲染进程想保存/打开项目时，通过 preload 暴露的接口走到这里来。
 */

const { app, BrowserWindow, dialog, ipcMain, net, shell } = require('electron');
const { readFile, stat, writeFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const updateCore = require('./update-core.cjs');
const { UnrealRemoteSession } = require('./unreal-remote.cjs');
const { runImport } = require('./unreal-import.cjs');
const unrealAssets = require('./unreal-assets.cjs');
const { queryUnrealCatalog } = require('./unreal-query.cjs');
const godotBridge = require('./godot-bridge.cjs');

/** 开发模式直接连 Vite，正式模式读打包进来的 dist */
const isDev = !app.isPackaged;

let mainWindow = null;

/** 最近一次检查拿到的最新清单；手动「下载更新」直接用它，省得再查一遍 */
let pendingUpdate = null;
/** 新 asar 是否已经下好并通过校验（重启时由更新脚本替换） */
let updateDownloaded = false;

const UPDATE_CHECK_TIMEOUT = 6000;

/** 拉一个小文本；连不上/超时都抛错，由调用方决定换源还是放弃 */
async function fetchText(url) {
  const response = await net.fetch(url, {
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT),
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * 拉更新日志，只保留「当前版本之后、最新版本之前」的条目。
 * 日志拿不到就当作没有，绝不能因此挡住更新本身。
 */
async function loadUpdateNotes(base, current, latest) {
  try {
    const parsed = updateCore.parseChangelog(await fetchText(`${base}/changelog.json`));
    return parsed === null ? [] : updateCore.collectNotes(parsed, current, latest);
  } catch {
    return [];
  }
}

/**
 * 问两个更新源要 version.json，取版本号最大的那份清单。
 * 任何一个源连不上都只是少一个候选，不影响另一个。
 */
async function checkForUpdate() {
  const current = app.getVersion();
  if (!app.isPackaged) {
    return { status: 'unsupported', current };
  }

  const bases = updateCore.updateBases();
  const entries = [];
  await Promise.all(
    bases.map(async (base) => {
      try {
        const manifest = updateCore.parseManifest(await fetchText(`${base}/version.json`));
        if (manifest !== null) entries.push({ base, manifest });
      } catch {
        // 这个源不通，换下一个
      }
    }),
  );

  const newest = updateCore.newestManifest(entries);
  if (newest === null) {
    pendingUpdate = null;
    return { status: 'error', current, message: '连不上更新源' };
  }

  if (updateCore.compareVersions(newest.manifest.version, current) <= 0) {
    pendingUpdate = null;
    return { status: 'latest', current, latest: newest.manifest.version };
  }

  pendingUpdate = newest;
  return {
    status: 'available',
    current,
    latest: newest.manifest.version,
    size: newest.manifest.size,
    notes: await loadUpdateNotes(newest.base, current, newest.manifest.version),
  };
}

/**
 * 下载新 asar 到 resources/app.asar.new，边下边核对清单里的 SHA-256。
 * 先试给过清单的那个源，再试其它源。
 */
async function downloadUpdate() {
  try {
    if (pendingUpdate === null) {
      const checked = await checkForUpdate();
      if (checked.status === 'latest') return { ok: false, message: '已经是最新版本' };
      if (checked.status !== 'available') return { ok: false, message: checked.message ?? '没有拿到更新信息' };
    }

    const manifest = pendingUpdate.manifest;
    const otherBases = updateCore
      .updateBases()
      .filter((base) => base !== pendingUpdate.base)
      .map((base) => `${base}/${manifest.file}`);
    const urls = [`${pendingUpdate.base}/${manifest.file}`, ...otherBases];

    const result = await updateCore.downloadVerified({
      urls,
      target: path.join(process.resourcesPath, 'app.asar.new'),
      sha256: manifest.sha256,
      size: manifest.size,
      fetchImpl: net.fetch,
    });
    if (!result.ok) return { ok: false, message: result.message };

    updateDownloaded = true;
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 退出后由一个小 bat 完成替换：运行中的 app.asar 是删不掉的，
 * 所以先等进程退掉（move 失败就重试），换好再把自己重新拉起来。
 *
 * 重试 60 次仍换不上（目录只读、被杀毒锁住）就直接启动旧版，
 * 不能把用户晾在没有窗口的状态里。
 */
async function applyUpdate() {
  if (!updateDownloaded) return { ok: false, message: '还没有下载更新' };

  const source = path.join(process.resourcesPath, 'app.asar.new');
  const target = path.join(process.resourcesPath, 'app.asar');
  try {
    await stat(source);
  } catch {
    updateDownloaded = false;
    return { ok: false, message: '更新文件不见了，请重新下载' };
  }

  const script = [
    '@echo off',
    'setlocal',
    'set "TARGET=%~1"',
    'set "SOURCE=%~2"',
    'set "EXE=%~3"',
    'set /a tries=0',
    ':retry',
    'move /Y "%SOURCE%" "%TARGET%" >nul 2>&1',
    'if not errorlevel 1 goto done',
    'set /a tries+=1',
    'if %tries% geq 60 goto done',
    'timeout /t 1 /nobreak >nul',
    'goto retry',
    ':done',
    'start "" "%EXE%"',
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');

  const scriptPath = path.join(os.tmpdir(), `storymaker-update-${Date.now()}.bat`);
  await writeFile(scriptPath, script, 'utf8');

  const child = spawn('cmd.exe', ['/d', '/c', scriptPath, target, source, app.getPath('exe')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // 给 bat 一点时间进入等待，再退出主进程
  setTimeout(() => app.quit(), 300);
  return { ok: true };
}

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

  // 界面出来 3 秒后瞄一眼有没有新版；连不上就当没有，绝不挡着人用
  if (!isDev && process.env.STORYMAKER_NO_UPDATE !== '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void checkForUpdate()
          .then((result) => {
            if (result.status !== 'available') return;
            if (mainWindow === null || mainWindow.isDestroyed()) return;
            mainWindow.webContents.send('update:available', {
              current: result.current,
              latest: result.latest,
              size: result.size,
              notes: result.notes ?? [],
            });
          })
          .catch(() => undefined);
      }, 3000);
    });
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

/** ---------- 自动更新 ---------- */

ipcMain.handle('update:check', async () => {
  try {
    return await checkForUpdate();
  } catch (error) {
    return {
      status: 'error',
      current: app.getVersion(),
      message: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle('update:download', () => downloadUpdate());
ipcMain.handle('update:apply', () => applyUpdate());

/** ---------- 导入到 Unreal ---------- */

/**
 * 本机唯一的 Remote Execution 会话。
 *
 * UDP 发现端口 6766 一个进程只能占一份，所以整个应用共用一个会话，
 * 发现和导入都走它；窗口关掉时统一关。
 */
let unrealSession = null;

function getUnrealSession() {
  if (unrealSession === null) unrealSession = new UnrealRemoteSession();
  return unrealSession;
}

/** 从 .uproject 路径取项目名，用来确认连的是这个工程而不是别的 */
function projectNameOf(uprojectPath) {
  const base = path.basename(String(uprojectPath ?? ''));
  return base.toLowerCase().endsWith('.uproject') ? base.slice(0, -'.uproject'.length) : base;
}

/**
 * 在发现的节点里挑目标编辑器。
 *
 * 优先按项目名对齐；只有一个编辑器在线时也接受，免得策划还得核对一遍名字。
 */
function pickNode(nodes, uprojectPath) {
  const expected = projectNameOf(uprojectPath);
  const sameName = nodes.filter(
    (node) => node.projectName.toLowerCase() === expected.toLowerCase(),
  );
  return sameName[0] ?? (nodes.length === 1 ? nodes[0] : undefined);
}

const NO_EDITOR_MESSAGE =
  '没有发现在线的 Unreal 编辑器。请先打开工程，并确认 Editor Preferences → Python → Enable Remote Execution 已勾上。';

ipcMain.handle('unreal:discover', async (_event, _uprojectPath, timeoutMs) => {
  try {
    const wait = Number(timeoutMs);
    const nodes = await getUnrealSession().discover(
      Number.isFinite(wait) && wait > 0 ? wait : 3000,
    );
    return nodes.length === 0 ? { nodes: [], error: NO_EDITOR_MESSAGE } : { nodes };
  } catch (error) {
    return { nodes: [], error: error instanceof Error ? error.message : String(error) };
  }
});

/** 连上编辑器查一次「有哪些数据表 / 有哪些文件夹」，给导入设置的下拉和目录树用 */
ipcMain.handle('unreal:query-catalog', async (_event, request) => {
  try {
    const session = getUnrealSession();
    const nodes = await session.discover(3000);
    if (nodes.length === 0) return { ok: false, message: NO_EDITOR_MESSAGE };

    const node = pickNode(nodes, request.uprojectPath);
    if (node === undefined) {
      const found = nodes.map((item) => item.projectName || '（未命名）').join('、');
      return { ok: false, message: `在线的编辑器里没有目标工程，发现的是：${found}` };
    }

    const catalog = await queryUnrealCatalog(session, node.id);
    if (catalog === null) return { ok: false, message: '编辑器没有回传数据表清单' };
    return { ok: true, dataTables: catalog.dataTables, folders: catalog.folders };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('unreal:import', async (event, request) => {
  try {
    const session = getUnrealSession();
    const nodes = await session.discover(3000);
    if (nodes.length === 0) return { ok: false, message: NO_EDITOR_MESSAGE };

    // 按项目名认目标；只有一个编辑器在线时也接受，免得策划还是得核对一遍名字
    const node = pickNode(nodes, request.uprojectPath);
    if (node === undefined) {
      const found = nodes.map((item) => item.projectName || '（未命名）').join('、');
      return {
        ok: false,
        message: `在线的编辑器里没有 ${projectNameOf(request.uprojectPath) || '目标工程'}，发现的是：${found}`,
      };
    }

    // 渲染进程已经把「要导哪些」筛好了（增量时只给变化项），这里照单执行
    const plan = {
      tables: request.plan.tables ?? [],
      images: request.plan.images ?? [],
      sounds: request.plan.sounds ?? [],
    };

    const onProgress = (progress) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('unreal:import-progress', progress);
    };

    const result = await runImport({ session, nodeId: node.id, plan, onProgress });

    return {
      ok: true,
      stopped: result.stopped,
      items: result.items,
      importedOwnerUids: result.importedOwnerUids,
      counts: result.counts,
      message: result.message,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('unreal:pick-uproject', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Unreal 项目文件',
    properties: ['openFile'],
    filters: [{ name: 'Unreal 项目', extensions: ['uproject'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('unreal:pick-asset-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择素材文件夹（png / wav 放这里，文件名就是图片 / 音效 ID）',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/** ---------- 素材文件夹：列表、上传、删除、读内容 ---------- */

ipcMain.handle('unreal:list-assets', async (_event, folder) => {
  try {
    return { ok: true, files: await unrealAssets.listAssetFiles(folder) };
  } catch (error) {
    return { ok: false, files: [], message: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('unreal:upload-asset', async (_event, request) => {
  const kind = request.kind === 'sound' ? 'sound' : 'image';
  const extensions = unrealAssets.allowedExtensions(kind);
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'sound' ? '选择音频文件' : '选择图片文件',
    properties: ['openFile'],
    filters: [{ name: kind === 'sound' ? '音频' : '图片', extensions }],
  });
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true };

  return unrealAssets.uploadAssetFile({
    folder: request.folder,
    id: request.id,
    kind,
    sourceFile: picked.filePaths[0],
    replace: request.replace === true,
  });
});

ipcMain.handle('unreal:rename-asset', async (_event, request) => {
  return unrealAssets.renameAssetFile({
    folder: request.folder,
    oldId: request.oldId,
    newId: request.newId,
    kind: request.kind === 'sound' ? 'sound' : 'image',
  });
});

ipcMain.handle('unreal:remove-asset', async (_event, filePath) => {
  return unrealAssets.removeAssetFile(filePath);
});

/** 预览图 / 播放音频用：把文件内容读给渲染进程，不走 file:// */
ipcMain.handle('unreal:read-asset', async (_event, filePath) => {
  try {
    return { ok: true, data: await readFile(filePath) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
});

/** 界面把 webp 转成 PNG 之后，写回素材文件夹（UE 不认 webp） */
ipcMain.handle('unreal:write-asset', async (_event, request) => {
  return unrealAssets.writeAssetFile({
    folder: request.folder,
    id: request.id,
    kind: request.kind === 'sound' ? 'sound' : 'image',
    extension: request.extension,
    data: request.data,
    replace: request.replace === true,
  });
});

/** ---------- Godot：插件安装与连接 ---------- */

/** 插件源码跟着安装包走；开发时就是仓库里的 godot-plugin/ */
function godotPluginSourceDir() {
  return path.join(app.getAppPath(), 'godot-plugin', 'addons', 'storymaker_bridge');
}

ipcMain.handle('godot:pick-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Godot 工程（project.godot）',
    properties: ['openFile'],
    filters: [{ name: 'Godot 工程', extensions: ['godot'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('godot:plugin-state', async (_event, projectPath) =>
  godotBridge.pluginState(projectPath),
);

ipcMain.handle('godot:install-plugin', async (_event, projectPath) =>
  godotBridge.installPlugin({ projectPath, sourceDir: godotPluginSourceDir() }),
);

ipcMain.handle('godot:ping', async (_event, projectPath, timeoutMs) =>
  godotBridge.ping(projectPath, timeoutMs),
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/** 退出前把发现端口让出来，否则下次启动要等系统回收 */
app.on('before-quit', () => {
  if (unrealSession !== null) {
    unrealSession.close();
    unrealSession = null;
  }
});
