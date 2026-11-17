'use strict';

/**
 * 「导入到 Unreal」的执行端。
 *
 * 渲染进程把计划（哪些表、哪些图、哪些音效）交过来，这里负责：
 *   1. 把每张表的 CSV 写到临时目录（UE 只认文件，不认内存里的字符串）
 *   2. 扫素材文件夹，按「文件名 = ID」把 png/wav 对到计划上
 *   3. 生成一段 UE Python 脚本，交给 Remote Execution 在编辑器里跑
 *   4. 解析脚本回传的结果
 *
 * 脚本生成是纯函数（buildImportScript），单独测；扫描和写文件要碰磁盘，走集成验证。
 */

const { mkdtemp, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tga']);
const SOUND_EXTENSIONS = new Set(['.wav', '.ogg', '.flac']);

/** 结果行前缀；脚本最后用 json 打一行，主进程按这个前缀找 */
const RESULT_PREFIX = 'SMK_IMPORT_RESULT ';
const DONE_MARKER = 'SMK_IMPORT_DONE';

/** 按扩展名判断是图还是音效；不认识的返回 null */
function materialKindOfFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (SOUND_EXTENSIONS.has(extension)) return 'sound';
  return null;
}

/** 递归扫素材文件夹，只收指定类别的文件 */
async function scanMaterialFolder(folder, kind) {
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
      if (materialKindOfFile(entry.name) !== kind) continue;
      files.push({
        filePath: full,
        baseName: path.basename(entry.name, path.extname(entry.name)),
      });
    }
  }
  await walk(folder);
  return files;
}

/**
 * 按「文件名 = ID」把文件对到计划上。
 *
 * 只做精确匹配：大小写不同也算没对上，宁可报错让人改文件名，也不猜着导错资源。
 */
function matchMaterialFiles(files, expected) {
  const wanted = new Set(expected.map((task) => task.id));
  const matched = new Map();
  const unused = [];

  for (const file of files) {
    if (!wanted.has(file.baseName) || matched.has(file.baseName)) {
      unused.push(file.filePath);
      continue;
    }
    matched.set(file.baseName, file.filePath);
  }

  const missing = expected.map((task) => task.id).filter((id) => !matched.has(id));
  return { matched, missing, unused };
}

/** 文件名里不能出现的字符换成下划线，免得写 CSV 时出错 */
function safeFileName(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, '_');
}

/** 把每张表的 CSV 写到临时目录，返回带 csvPath 的任务 */
async function writeCsvFiles(tables, directory) {
  const written = [];
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    const fileName = `${String(index + 1).padStart(2, '0')}-${safeFileName(table.label)}.csv`;
    const csvPath = path.join(directory, fileName);
    await writeFile(csvPath, table.csvText, 'utf8');
    written.push({ label: table.label, assetPath: table.assetPath, csvPath });
  }
  return written;
}

/**
 * 生成在编辑器里跑的 Python 脚本。
 *
 * 设计上刻意「一项失败不影响别的」：每张表、每张图各自 try/except，
 * 最后统一回传一份结果清单，界面按条显示成功与失败原因。
 */
function buildImportScript(payload) {
  const dataLiteral = JSON.stringify(JSON.stringify(payload));

  return [
    '# -*- coding: utf-8 -*-',
    '# 由 StoryMaker 生成：把 CSV 灌进数据表，把 png/wav 导成纹理和音效',
    'import unreal',
    'import json',
    '',
    `DATA = json.loads(${dataLiteral})`,
    '',
    'results = []',
    '',
    'def add(kind, label, ok, detail):',
    '    results.append({"kind": kind, "label": label, "ok": bool(ok), "detail": detail})',
    '',
    'def split_package(package_path):',
    '    index = package_path.rfind("/")',
    '    if index <= 0:',
    '        return "", package_path',
    '    return package_path[:index], package_path[index + 1:]',
    '',
    'def import_asset(kind, item, folder, name):',
    '    task = unreal.AssetImportTask()',
    '    task.set_editor_property("filename", item["sourcePath"])',
    '    task.set_editor_property("destination_path", folder)',
    '    task.set_editor_property("destination_name", name)',
    '    task.set_editor_property("replace_existing", True)',
    '    task.set_editor_property("automated", True)',
    '    task.set_editor_property("save", True)',
    '    asset_tools.import_asset_tasks([task])',
    '    imported = list(task.get_editor_property("imported_object_paths"))',
    '    add(kind, item["id"], len(imported) > 0, "已导入" if imported else "导入没有产出资产")',
    '',
    'asset_tools = unreal.AssetToolsHelpers.get_asset_tools()',
    '',
    '# ---------- 数据表：CSV 直接灌进去 ----------',
    'for table in DATA["tables"]:',
    '    try:',
    '        asset = unreal.load_asset(table["assetPath"])',
    '        if asset is None:',
    '            add("table", table["label"], False, "找不到数据表资产：" + table["assetPath"])',
    '            continue',
    '        filled = unreal.DataTableFunctionLibrary.fill_data_table_from_csv_file(asset, table["csvPath"])',
    '        if filled:',
    '            unreal.EditorAssetLibrary.save_loaded_asset(asset)',
    '        add("table", table["label"], filled, "已导入" if filled else "CSV 与数据表结构不匹配，详见上方日志")',
    '    except Exception as error:',
    '        add("table", table["label"], False, str(error))',
    '',
    '# ---------- 图片 / 音效：走资源导入管线 ----------',
    'for kind, key in (("image", "images"), ("sound", "sounds")):',
    '    for item in DATA[key]:',
    '        try:',
    '            folder, name = split_package(item["assetPath"])',
    '            if folder == "":',
    '                add(kind, item["id"], False, "资源路径不合法：" + item["assetPath"])',
    '                continue',
    '            import_asset(kind, item, folder, name)',
    '        except Exception as error:',
    '            add(kind, item["id"], False, str(error))',
    '',
    `unreal.log("${RESULT_PREFIX}" + json.dumps(results, ensure_ascii=False))`,
    `unreal.log("${DONE_MARKER}")`,
    '',
  ].join('\n');
}

/**
 * 跑一轮导入。
 *
 * @param {object} options
 * @param {object} options.session UnrealRemoteSession
 * @param {string} options.nodeId 目标编辑器节点
 * @param {{tables: Array, images: Array, sounds: Array}} options.plan
 * @param {string} options.assetFolder 素材文件夹；空串表示这次不导素材
 * @param {number} [options.timeoutMs]
 */
async function runImport({ session, nodeId, plan, assetFolder, timeoutMs }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'storymaker-ue-'));
  try {
    const tables = await writeCsvFiles(plan.tables ?? [], tempDir);

    const imageFiles = assetFolder === '' ? [] : await scanMaterialFolder(assetFolder, 'image');
    const soundFiles = assetFolder === '' ? [] : await scanMaterialFolder(assetFolder, 'sound');
    const imageMatch = matchMaterialFiles(imageFiles, plan.images ?? []);
    const soundMatch = matchMaterialFiles(soundFiles, plan.sounds ?? []);

    const images = (plan.images ?? [])
      .filter((task) => imageMatch.matched.has(task.id))
      .map((task) => ({
        id: task.id,
        assetPath: task.assetPath,
        sourcePath: imageMatch.matched.get(task.id),
      }));
    const sounds = (plan.sounds ?? [])
      .filter((task) => soundMatch.matched.has(task.id))
      .map((task) => ({
        id: task.id,
        assetPath: task.assetPath,
        sourcePath: soundMatch.matched.get(task.id),
      }));

    const script = buildImportScript({ tables, images, sounds });
    const outcome = await session.runScript(nodeId, script, { timeoutMs });

    return {
      outcome,
      counts: { tables: tables.length, images: images.length, sounds: sounds.length },
      missing: { images: imageMatch.missing, sounds: soundMatch.missing },
      unused: { images: imageMatch.unused, sounds: soundMatch.unused },
      skipped: {
        images: (plan.images ?? []).length - images.length,
        sounds: (plan.sounds ?? []).length - sounds.length,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = {
  DONE_MARKER,
  RESULT_PREFIX,
  buildImportScript,
  matchMaterialFiles,
  materialKindOfFile,
  runImport,
  scanMaterialFolder,
  writeCsvFiles,
};
