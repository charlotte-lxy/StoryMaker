'use strict';

/**
 * 素材文件夹的读写：列表、上传（复制 + 按 ID 重命名）、删除、读内容。
 *
 * 素材文件夹是策划本机上的一个目录，里面按类别分了三个子目录：
 * `Image/` 放图片、`Sound/` 放音效、`Fonts/` 放字体；
 * **文件名（不含扩展名）就是图片 ID / 音效 ID**，字体则用显示名称当文件名。
 * 立绘 / 音效模块的「素材管理」列与字体子模块全靠这一套。
 *
 * 老版本的素材是平铺在根目录的：列表照样递归扫得到，不用手工搬；
 * 但新传的都进对应子目录，不再往根上堆。
 */

const { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');

/** 素材文件夹里允许存在的图片格式：都是 UE 能直接导进去的 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tga'];
/** 上传时还能额外选 webp：会先转成 PNG 再放进素材文件夹，不直接落地 */
const WEBP_EXTENSION = '.webp';
const UPLOAD_IMAGE_EXTENSIONS = [...IMAGE_EXTENSIONS, WEBP_EXTENSION];
const SOUND_EXTENSIONS = ['.wav', '.ogg', '.flac'];
/** 字体：UE 认的两种字体文件 */
const FONT_EXTENSIONS = ['.ttf', '.otf'];

/** 每个类别在素材文件夹里的子目录（和 UE 内容目录的 Image / Sound 对齐） */
const KIND_FOLDERS = { image: 'Image', sound: 'Sound', font: 'Fonts' };

/** 文件属于哪一类；不认识的返回 null（webp 不算素材格式，它只是上传来源） */
function kindOfFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (SOUND_EXTENSIONS.includes(extension)) return 'sound';
  if (FONT_EXTENSIONS.includes(extension)) return 'font';
  return null;
}

/** 某个类别允许的扩展名，给文件选择框用（不带点） */
function allowedExtensions(kind) {
  if (kind === 'sound') return SOUND_EXTENSIONS.map((ext) => ext.slice(1));
  if (kind === 'font') return FONT_EXTENSIONS.map((ext) => ext.slice(1));
  return UPLOAD_IMAGE_EXTENSIONS.map((ext) => ext.slice(1));
}

/** 某个类别的素材应该落在哪个目录（不存在就建出来） */
async function folderForKind(folder, kind) {
  const target = path.join(folder, KIND_FOLDERS[kind] ?? KIND_FOLDERS.image);
  await mkdir(target, { recursive: true }).catch(() => undefined);
  return target;
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
 * 「重新选择素材」：同一个 ID 只留一份，把别的扩展名清掉。
 *
 * keepPath 是刚写进去的那一份，跳过它。
 */
async function removeOtherFilesWithBaseName(folder, baseName, keepPath, kind) {
  const existing = await listAssetFiles(folder);
  for (const file of existing) {
    if (file.baseName !== baseName) continue;
    if (kind !== undefined && file.kind !== kind) continue;
    if (path.resolve(file.filePath) === path.resolve(keepPath)) continue;
    await rm(file.filePath, { force: true }).catch(() => undefined);
  }
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
  if (kind !== 'font' && name === '') {
    return { ok: false, message: '这一行还没有 ID，先填 ID 再传素材' };
  }

  const extension = path.extname(sourceFile).toLowerCase();
  const isWebp = extension === WEBP_EXTENSION;
  const fileKind = kindOfFile(sourceFile) ?? (isWebp ? 'image' : null);
  if (fileKind === null) {
    return { ok: false, message: `不支持的文件格式：${extension || '没有扩展名'}` };
  }
  if (fileKind !== kind) {
    const expected = allowedExtensions(kind).map((ext) => `.${ext}`).join('、');
    return { ok: false, message: `这里只收 ${expected}，你选的是 ${extension}` };
  }

  // webp 不能直接进素材文件夹（UE 不认）：交给界面转成 PNG 再写回来
  if (isWebp) {
    return { ok: false, requiresConversion: true, sourcePath: sourceFile };
  }

  // 字体保留原文件名：字体文件的名字本身就是最有用的信息，没必要按 ID 改
  const fileName = kind === 'font' ? safeFileName(baseNameOf(sourceFile)) : name;
  const kindFolder = await folderForKind(targetFolder, kind);
  const targetPath = path.join(kindFolder, `${fileName}${extension}`);

  try {
    await copyFile(sourceFile, targetPath);
  } catch (error) {
    return { ok: false, message: `复制失败：${error instanceof Error ? error.message : String(error)}` };
  }

  // 「重新选择素材」：同一个 ID 只该留一份，把别的扩展名清掉
  if (replace) {
    await removeOtherFilesWithBaseName(targetFolder, fileName, targetPath, kind);
  }

  return { ok: true, filePath: targetPath };
}

/**
 * 把界面转好的图片字节写进素材文件夹（webp → PNG 用）。
 *
 * 扩展名只收素材文件夹里合法的那些，所以这里不会写进 .webp。
 */
async function writeAssetFile({ folder, id, kind, extension, data, replace = false }) {
  const targetFolder = typeof folder === 'string' ? folder.trim() : '';
  if (targetFolder === '') return { ok: false, message: '还没有在设置里选素材文件夹' };

  const name = safeFileName(id);
  if (name === '') return { ok: false, message: '这一行还没有 ID，先填 ID 再传素材' };

  const raw = String(extension ?? '').toLowerCase();
  const ext = raw.startsWith('.') ? raw : `.${raw}`;
  const allowed =
    kind === 'sound' ? SOUND_EXTENSIONS : kind === 'font' ? FONT_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!allowed.includes(ext)) {
    return { ok: false, message: `不支持写入的格式：${ext === '.' ? '没有扩展名' : ext}` };
  }

  if (!(data instanceof Uint8Array) || data.length === 0) {
    return { ok: false, message: '没有收到要写入的图片内容' };
  }

  const kindFolder = await folderForKind(targetFolder, kind);
  const targetPath = path.join(kindFolder, `${name}${ext}`);
  try {
    await writeFile(targetPath, Buffer.from(data));
  } catch (error) {
    return {
      ok: false,
      message: `写入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (replace) {
    await removeOtherFilesWithBaseName(targetFolder, name, targetPath, kind);
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

/**
 * 条目改了 ID 之后，把素材文件跟着改名。
 *
 * 只改文件名，内容不动，所以修改时间也不变——这正是「改名」和「修改」要分开判的原因。
 * 没有对应文件时算成功（本来就没什么可改的）。
 */
async function renameAssetFile({ folder, oldId, newId, kind }) {
  const targetFolder = typeof folder === 'string' ? folder.trim() : '';
  if (targetFolder === '') return { ok: false, message: '还没有在设置里选素材文件夹' };

  const from = safeFileName(oldId);
  const to = safeFileName(newId);
  if (from === '' || to === '') return { ok: false, message: 'ID 不能为空' };
  if (from === to) return { ok: true };

  const files = await listAssetFiles(targetFolder);
  const source = files.find((file) => file.baseName === from && file.kind === kind);
  if (source === undefined) return { ok: true };

  const extension = path.extname(source.filePath);
  // 改名留在原目录里：别把 Image/ 里的图片挪到根上
  const targetPath = path.join(path.dirname(source.filePath), `${to}${extension}`);

  const occupied = await stat(targetPath).catch(() => null);
  if (occupied !== null) {
    return {
      ok: false,
      message: `素材文件夹里已经有 ${path.basename(targetPath)} 了，先把它删掉或换个 ID`,
    };
  }

  try {
    await rename(source.filePath, targetPath);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  return { ok: true, filePath: targetPath };
}

/** 读素材文件内容，给界面做预览图和音频播放 */
async function readAssetFile(filePath) {
  return readFile(filePath);
}

module.exports = {
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  KIND_FOLDERS,
  SOUND_EXTENSIONS,
  UPLOAD_IMAGE_EXTENSIONS,
  allowedExtensions,
  baseNameOf,
  folderForKind,
  kindOfFile,
  listAssetFiles,
  readAssetFile,
  removeAssetFile,
  renameAssetFile,
  uploadAssetFile,
  writeAssetFile,
};
