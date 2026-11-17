/**
 * 自动更新的纯逻辑：版本比较、清单校验、按清单下载并核对 SHA-256。
 *
 * 这里刻意不 require('electron')：主进程把 net.fetch 传进来，自检脚本
 * （tools/verify-app-update.mts）用 Node 的 fetch 就能整套跑一遍，不用真的开窗口。
 *
 * 更新只换 resources/app.asar 一个文件（约 1.4 MB），exe 和 Electron 运行时不参与，
 * 所以下载量很小；换来的是 exe 里的版本资源会停在它被安装时的那一版。
 */

'use strict';

const { createHash } = require('node:crypto');
const { rename, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');

/** 两个更新源：GitHub raw 为主，jsDelivr 镜像兜底（国内 raw 时常连不上） */
const DEFAULT_BASES = [
  'https://raw.githubusercontent.com/charlotte-lxy/StoryMaker/main/app-update',
  'https://cdn.jsdelivr.net/gh/charlotte-lxy/StoryMaker@main/app-update',
];

/**
 * 更新源列表。环境变量 STORYMAKER_APP_UPDATE_BASE 可用逗号分隔覆盖（自检脚本用）。
 */
function updateBases(value) {
  const raw = value === undefined ? process.env.STORYMAKER_APP_UPDATE_BASE : value;
  const list = String(raw ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item !== '');
  return list.length > 0 ? list : DEFAULT_BASES.slice();
}

/** 按数字段比较版本号；返回值 >0 表示 a 比 b 新。只认 x.y.z，预发布后缀忽略 */
function compareVersions(a, b) {
  const split = (value) =>
    String(value)
      .split('-')[0]
      .split('.')
      .map((part) => {
        const number = Number.parseInt(part, 10);
        return Number.isFinite(number) ? number : 0;
      });
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 清单格式：
 * { "version": "0.1.64", "file": "app.asar", "sha256": "<64 位小写十六进制>", "size": 1509000 }
 *
 * 文件名写死成 app.asar，免得清单被塞进 ../ 之类的路径。
 */
function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  const version = String(data.version ?? '').trim();
  if (!/^\d+(\.\d+)*$/.test(version)) return null;

  const file = String(data.file ?? 'app.asar');
  if (file !== 'app.asar') return null;

  const sha256 = String(data.sha256 ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;

  const size = Number(data.size);
  if (!Number.isInteger(size) || size <= 0) return null;

  return { version, file, sha256, size };
}

/** 从各个更新源拿到的清单里挑版本号最大的那份 */
function newestManifest(entries) {
  let best = null;
  for (const entry of entries) {
    if (entry === undefined || entry === null) continue;
    if (best === null || compareVersions(entry.manifest.version, best.manifest.version) > 0) {
      best = entry;
    }
  }
  return best;
}

/**
 * 更新日志清单（由 tools/make-app-update.mts 从 CHANGELOG.md 生成）：
 * { "versions": [ { "version": "0.6.6", "items": ["…", "…"] }, … ] }
 */
function parseChangelog(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.versions)) return null;
  return data;
}

/**
 * 取「当前版本之后、最新版本之前」的全部条目，按版本从新到旧排。
 * 客户端跳了好几个版本时，这里会把中间每一版的内容都带上。
 */
function collectNotes(changelog, current, latest) {
  if (changelog === null || changelog === undefined || !Array.isArray(changelog.versions)) return [];
  const notes = [];
  for (const entry of changelog.versions) {
    if (entry === null || typeof entry !== 'object') continue;
    const version = String(entry.version ?? '').trim();
    if (!/^\d+(\.\d+)*$/.test(version)) continue;
    const afterCurrent = compareVersions(version, current) > 0;
    const upToLatest = compareVersions(version, latest) <= 0;
    if (!afterCurrent || !upToLatest) continue;
    const items = Array.isArray(entry.items)
      ? entry.items.map((item) => String(item).trim()).filter((item) => item !== '')
      : [];
    if (items.length === 0) continue;
    notes.push({ version, items });
  }
  return notes.sort((left, right) => compareVersions(right.version, left.version));
}

function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 按顺序试每个 URL：下完先核对大小和 SHA-256，对不上就换下一个源再来一次。
 * 只有校验通过才会落到 target（先写临时文件再改名，避免留下半截 asar）。
 */
async function downloadVerified({ urls, target, sha256, size, fetchImpl, timeoutMs = 120_000, attempts = 2 }) {
  const directory = path.dirname(target);
  let lastMessage = '连不上更新源';

  for (const url of urls) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let tempPath = null;
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
          lastMessage = `下载失败（HTTP ${response.status}）`;
          break; // 这个源不行，换下一个
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength !== size) {
          lastMessage = '下载下来的文件大小不对';
          continue;
        }
        if (sha256Of(buffer) !== sha256) {
          lastMessage = '下载下来的文件校验不通过';
          continue;
        }
        tempPath = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
        await writeFile(tempPath, buffer);
        await rename(tempPath, target);
        return { ok: true, url };
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
      } finally {
        if (tempPath !== null) await rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }

  return { ok: false, message: lastMessage };
}

module.exports = {
  DEFAULT_BASES,
  updateBases,
  compareVersions,
  parseManifest,
  newestManifest,
  parseChangelog,
  collectNotes,
  sha256Of,
  downloadVerified,
};
