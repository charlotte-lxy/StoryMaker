'use strict';

/**
 * 素材文件夹的读写：列表、上传（复制 + 按 ID 重命名）、删除、读内容。
 *
 * 素材文件夹是策划本机上的一个目录，png / wav 丢在里面，**文件名（不含扩展名）就是
 * 图片 ID / 音效 ID**。立绘和音效模块的「素材管理」列全靠这一套。
 *
 * 上传一律**平铺到素材文件夹根目录**，不做子文件夹——和导入时「递归扫、按文件名对 ID」
 * 的规则保持一致，放哪一层都认，但新传的都在最外层，好找。
 */

const { copyFile, readFile, readdir, rm, stat } = require('node:fs/promises');
const path = require('node:path');

/** 上传时允许的格式：都是 UE 能直接导进去的 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tga'];
const SOUND_EXTENSIONS = ['.wav', '.ogg', '.flac'];

/** 文件属于哪一类；不认识的返回 null */
function kindOfFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (SOUND_EXTENSIONS.includes(extension)) return 'sound';
  return null;
}

/** 某个类别允许的扩展名，给文件选择框用（不带点） */
function allowedExtensions(kind) {
  return (kind === 'sound' ? SOUND_EXTENSIONS : IMAGE_EXTENSIONS).map((ext) => ext.slice(1));
}

/** 去掉扩展名的文件名 */
function baseNameOf(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

/** 文件名里不能出现的字符换成下划线；ID 本身可以带中文和减号 */
function safeFileName(text) {
  return String(text).trim().replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 递归列出素材文件夹里的图片与音效。
 *
 * 素材可能几十上百个，但只返回文件名和路径，不读内容，代价很小。
 */
async function listAssetFiles(folder) {
  if (typeof folder !== 'string' || folder.trim() === '') return [];

  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const kind = kindOfFile(entry.name);
      if (kind === null) continue;
      // 大小与修改时间给「增量导入」判断用：文件被覆盖后这两个会变
      const info = await stat(full).catch(() => null);
      if (info === null) continue;
      files.push({
        filePath: full,
        fileName: entry.name,
        baseName: baseNameOf(entry.name),
        kind,
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
  }

  await walk(folder);
  return files;
}

/**
 * 把用户选中的文件复制进素材文件夹，并按 `<ID><原扩展名>` 重命名。
 *
 * @param {object} options
 * @param {string} options.folder 素材文件夹
 * @param {string} options.id 图片 / 音效 ID，决定新文件名
 * @param {'image'|'sound'} options.kind
 * @param {string} options.sourceFile 用户选中的原始文件
 * @param {boolean} [options.replace] 是否先删掉同一个 ID 的其他素材文件（「重新选择素材」用）
 */
async function uploadAssetFile({ folder, id, kind, sourceFile, replace = false }) {
  const targetFolder = typeof folder === 'string' ? folder.trim() : '';
  if (targetFolder === '') return { ok: false, message: '还没有在设置里选素材文件夹' };

  const name = safeFileName(id);
  if (name === '') return { ok: false, message: '这一行还没有 ID，先填 ID 再传素材' };

  const extension = path.extname(sourceFile).toLowerCase();
  const fileKind = kindOfFile(sourceFile);
  if (fileKind === null) {
    return { ok: false, message: `不支持的文件格式：${extension || '没有扩展名'}` };
  }
  if (fileKind !== kind) {
    const expected = allowedExtensions(kind).map((ext) => `.${ext}`).join('、');
    return { ok: false, message: `这里只收 ${expected}，你选的是 ${extension}` };
  }

  const targetPath = path.join(targetFolder, `${name}${extension}`);

  try {
    await copyFile(sourceFile, targetPath);
  } catch (error) {
    return { ok: false, message: `复制失败：${error instanceof Error ? error.message : String(error)}` };
  }

  // 「重新选择素材」：同一个 ID 只该留一份，把别的扩展名清掉
  if (replace) {
    const existing = await listAssetFiles(targetFolder);
    for (const file of existing) {
      if (file.baseName !== name) continue;
      if (path.resolve(file.filePath) === path.resolve(targetPath)) continue;
      await rm(file.filePath, { force: true }).catch(() => undefined);
    }
  }

  return { ok: true, filePath: targetPath };
}

/** 删掉一个素材文件；文件已经不在了也算成功（界面重新扫一遍就对了） */
async function removeAssetFile(filePath) {
  try {
    await rm(filePath, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 读素材文件内容，给界面做预览图和音频播放 */
async function readAssetFile(filePath) {
  return readFile(filePath);
}

module.exports = {
  IMAGE_EXTENSIONS,
  SOUND_EXTENSIONS,
  allowedExtensions,
  baseNameOf,
  kindOfFile,
  listAssetFiles,
  readAssetFile,
  removeAssetFile,
  uploadAssetFile,
};
