/**
 * 和 Godot 编辑器的连接。
 *
 * 插件（godot-plugin/addons/storymaker_bridge）在编辑器里开一个只绑 127.0.0.1 的
 * TCP 端口，把「端口 + 每次启动随机生成的令牌」写进工程的 .godot/storymaker_bridge.json。
 * 这里负责三件事：装上/检查插件、读配对文件、拿令牌发一次 ping。
 *
 * 不 require electron：文件对话框在主进程里做，这样这一层能单独测。
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/** 装进 Godot 工程后，插件在 project.godot 里的启用项 */
const PLUGIN_ID = 'res://addons/storymaker_bridge/plugin.cfg';
const PLUGIN_DIR = 'storymaker_bridge';
/** 插件就这两个文件，装的时候逐个读出来写过去 */
const PLUGIN_FILES = ['plugin.cfg', 'plugin.gd'];
const PAIRING_FILE = path.join('.godot', 'storymaker_bridge.json');

const NO_PROJECT_MESSAGE = '还没选 Godot 工程：先选一个 project.godot 文件。';

/** 用户可能选的是 project.godot，也可能直接给工程目录 */
function projectDirOf(projectPath) {
  const resolved = path.resolve(String(projectPath ?? ''));
  return path.basename(resolved).toLowerCase() === 'project.godot'
    ? path.dirname(resolved)
    : resolved;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** 读插件写下的配对文件；不存在或内容不合法都返回 null */
function readPairing(projectDir) {
  const file = path.join(projectDir, PAIRING_FILE);
  if (!isFile(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const port = Number(parsed?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof parsed.token !== 'string' || parsed.token === '') return null;
    return {
      port,
      token: parsed.token,
      pluginVersion: typeof parsed.pluginVersion === 'string' ? parsed.pluginVersion : '',
      projectPath: typeof parsed.projectPath === 'string' ? parsed.projectPath : '',
      pid: Number(parsed.pid) || 0,
    };
  } catch {
    return null;
  }
}

/** 读已装插件的版本号；没装返回空串 */
function installedVersion(projectDir) {
  const cfg = path.join(projectDir, 'addons', PLUGIN_DIR, 'plugin.cfg');
  if (!isFile(cfg)) return '';
  const match = /version\s*=\s*"([^"]*)"/.exec(fs.readFileSync(cfg, 'utf8'));
  return match === null ? '' : match[1];
}

/** 按 `[editor_plugins]` 段解析 enabled 里有哪些项 */
function enabledPlugins(projectText) {
  const lines = projectText.split(/\r?\n/);
  let inSection = false;
  let collecting = false;
  let joined = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting && /^\[.*\]$/.test(trimmed)) {
      inSection = trimmed.toLowerCase() === '[editor_plugins]';
      continue;
    }
    if (!inSection) continue;

    if (!collecting && trimmed.startsWith('enabled=')) {
      collecting = true;
      joined = trimmed.slice('enabled='.length);
    } else if (collecting) {
      joined += trimmed;
    }

    if (collecting && joined.includes(')')) {
      const inside = joined.slice(joined.indexOf('(') + 1, joined.lastIndexOf(')'));
      return [...inside.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    }
  }
  return [];
}

/** 把插件启用项写进 project.godot，保留原来的换行符和其余内容 */
function enablePlugin(projectText) {
  const entries = enabledPlugins(projectText);
  if (entries.includes(PLUGIN_ID)) return { text: projectText, changed: false };

  const eol = projectText.includes('\r\n') ? '\r\n' : '\n';
  const next = [...entries, PLUGIN_ID];
  const packed = `enabled=PackedStringArray(${next.map((item) => `"${item}"`).join(', ')})`;
  const lines = projectText.split(/\r?\n/);

  let sectionStart = -1;
  let enabledStart = -1;
  let enabledEnd = -1;
  let collecting = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!collecting && /^\[.*\]$/.test(trimmed)) {
      if (trimmed.toLowerCase() === '[editor_plugins]') sectionStart = index;
      continue;
    }
    if (sectionStart < 0) continue;
    if (!collecting && trimmed.startsWith('enabled=')) {
      collecting = true;
      enabledStart = index;
      enabledEnd = index;
      if (trimmed.includes(')')) break;
    } else if (collecting) {
      enabledEnd = index;
      if (trimmed.includes(')')) break;
    }
  }

  if (enabledStart >= 0) {
    lines.splice(enabledStart, enabledEnd - enabledStart + 1, packed);
  } else if (sectionStart >= 0) {
    lines.splice(sectionStart + 1, 0, '', packed);
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '[editor_plugins]', '', packed, '');
  }

  return { text: lines.join(eol), changed: true };
}

/** 插件装没装、启没启用、有没有配对文件 */
function pluginState(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    return { ok: false, message: NO_PROJECT_MESSAGE };
  }
  const projectDir = projectDirOf(projectPath);
  const projectFile = path.join(projectDir, 'project.godot');
  if (!isFile(projectFile)) {
    return { ok: false, message: '这个路径下没有 project.godot，确认一下选的是 Godot 工程。' };
  }

  const version = installedVersion(projectDir);
  const enabled = enabledPlugins(fs.readFileSync(projectFile, 'utf8')).includes(PLUGIN_ID);
  return {
    ok: true,
    projectDir,
    installed: version !== '',
    enabled,
    version,
    pairing: readPairing(projectDir) !== null,
  };
}

/** 把插件源码复制进工程并在 project.godot 里启用它 */
function installPlugin({ projectPath, sourceDir } = {}) {
  const state = pluginState(projectPath);
  if (state.ok !== true) return { ok: false, message: state.message };

  const sourceCfg = path.join(String(sourceDir ?? ''), 'plugin.cfg');
  if (!isFile(sourceCfg)) {
    return { ok: false, message: '安装包坏了：找不到插件源码（godot-plugin/addons/storymaker_bridge）。' };
  }

  const targetDir = path.join(state.projectDir, 'addons', PLUGIN_DIR);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // 逐个读写的而不是 cpSync：打包后源码在 app.asar 里，cpSync 不一定认这个路径
    for (const name of PLUGIN_FILES) {
      fs.writeFileSync(
        path.join(targetDir, name),
        fs.readFileSync(path.join(String(sourceDir), name)),
      );
    }

    const projectFile = path.join(state.projectDir, 'project.godot');
    const original = fs.readFileSync(projectFile, 'utf8');
    const result = enablePlugin(original);
    if (result.changed) fs.writeFileSync(projectFile, result.text, 'utf8');
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    projectDir: state.projectDir,
    message: '插件已安装。重启 Godot 编辑器后，再来点「检测连接」。',
  };
}

function samePath(a, b) {
  const left = path.resolve(String(a ?? ''));
  const right = path.resolve(String(b ?? ''));
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * 拿配对文件里的令牌发一次 ping。
 *
 * 连上了还要核对工程路径：端口是固定的，可能被另一个 Godot 实例占着。
 */
function ping(projectPath, timeoutMs = 2000) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    return Promise.resolve({ ok: false, message: NO_PROJECT_MESSAGE });
  }
  const projectDir = projectDirOf(projectPath);
  const pairing = readPairing(projectDir);
  if (pairing === null) {
    return Promise.resolve({
      ok: false,
      message: '没找到配对文件：插件还没装，或者装完没重启 Godot 编辑器。',
    });
  }

  const wait = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 2000;

  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port: pairing.port });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(wait);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 1, action: 'ping', token: pairing.token })}\n`);
    });
    const handleReply = (text) => {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        finish({ ok: false, message: '编辑器回了一段看不懂的内容，插件的版本可能对不上。' });
        return;
      }
      if (parsed?.ok !== true) {
        finish({ ok: false, message: String(parsed?.error ?? '编辑器拒绝了这次请求') });
        return;
      }
      const editor = parsed.result ?? {};
      if (!samePath(editor.projectPath, projectDir)) {
        finish({
          ok: false,
          message: `这个端口上的编辑器是另一个工程（${editor.projectPath || '未知路径'}）。`,
        });
        return;
      }
      finish({
        ok: true,
        editor: {
          pluginVersion: String(editor.pluginVersion ?? ''),
          projectName: String(editor.projectName ?? ''),
          projectPath: String(editor.projectPath ?? ''),
          engineVersion: String(editor.engineVersion ?? ''),
          pid: Number(editor.pid) || 0,
        },
      });
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handleReply(buffer.slice(0, newline));
    });
    // 老版本插件回包不带换行，对端关掉之后再看一眼剩下的内容
    socket.on('end', () => {
      const rest = buffer.trim();
      if (rest !== '') handleReply(rest);
    });
    socket.on('timeout', () => finish({ ok: false, message: 'Godot 编辑器没有响应，可能正忙。' }));
    socket.on('error', (error) => {
      const code = error && typeof error === 'object' ? error.code : '';
      finish({
        ok: false,
        message:
          code === 'ECONNREFUSED'
            ? '端口没人监听：Godot 编辑器没开，或插件没启用。'
            : error instanceof Error
              ? error.message
              : String(error),
      });
    });
  });
}

module.exports = {
  PLUGIN_ID,
  PAIRING_FILE,
  projectDirOf,
  readPairing,
  enabledPlugins,
  enablePlugin,
  pluginState,
  installPlugin,
  ping,
};
