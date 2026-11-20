'use strict';

/**
 * 「导入到 Unreal」的执行端。
 *
 * 一条命令通道上逐项跑：先素材、后数据表，每一项单独发一段 Python，
 * 这样主进程能立刻把「正在导哪个文件、到第几个了」推给界面。
 *
 * 阶段顺序是有讲究的：**素材导完并全部成功之后才导数据表**。数据表里存的是
 * 资源引用，素材没进去就灌表的话，引用会指向不存在的资产。
 */

const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/** 单项结果行前缀：Python 脚本最后打一行 JSON，这里按前缀取 */
const ITEM_RESULT_PREFIX = 'SMK_ITEM_RESULT ';

/** 单张图 / 单条音效的导入超时（毫秒） */
const ASSET_TIMEOUT_MS = 120_000;

/** 单张数据表的超时（毫秒）：大表灌 CSV 可能要一会 */
const TABLE_TIMEOUT_MS = 180_000;

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

/** 把 Python 里要用的数据嵌进脚本：转两次 JSON，既安全又保留中文 */
function embedData(value) {
  return JSON.stringify(JSON.stringify(value));
}

/**
 * 导入一张图 / 一条音效的脚本。
 *
 * 用 AssetImportTask 走导入管线（等价于在内容浏览器里拖进去），
 * 目标路径和资产名直接取导出表里那个完整引用，和策划看到的表永远一致。
 *
 * 条目改过 ID 时（`previousAssetPath`），先把 UE 里的旧资产改名过去再导，
 * 这样改 ID 不会留下一份旧资产。
 */
function buildAssetScript(item) {
  return [
    '# -*- coding: utf-8 -*-',
    'import unreal',
    'import json',
    '',
    `item = json.loads(${embedData(item)})`,
    'result = {"ok": False, "detail": ""}',
    'try:',
    '    asset_path = item["assetPath"]',
    '    index = asset_path.rfind("/")',
    '    if index <= 0:',
    '        result["detail"] = "资源路径不合法：" + asset_path',
    '    else:',
    '        previous = item.get("previousAssetPath")',
    '        if previous and previous != asset_path:',
    '            if unreal.EditorAssetLibrary.does_asset_exist(previous):',
    '                unreal.EditorAssetLibrary.rename_asset(previous, asset_path)',
    '        folder = asset_path[:index]',
    '        name = asset_path[index + 1:]',
    '        task = unreal.AssetImportTask()',
    '        task.set_editor_property("filename", item["sourcePath"])',
    '        task.set_editor_property("destination_path", folder)',
    '        task.set_editor_property("destination_name", name)',
    '        task.set_editor_property("replace_existing", True)',
    '        task.set_editor_property("automated", True)',
    '        task.set_editor_property("save", True)',
    '        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])',
    '        imported = list(task.get_editor_property("imported_object_paths"))',
    '        if not imported:',
    '            result["detail"] = "导入没有产出资产"',
    '        elif item.get("kind") == "sound":',
    '            # 音量 / 音调存在音效条目上：导完把值写进 SoundWave 资产再保存',
    '            sound = unreal.load_asset(asset_path)',
    '            if sound is None:',
    '                result["detail"] = "导入成功，但找不到音频资产：" + asset_path',
    '            else:',
    '                volume = float(item.get("volume", 1.0))',
    '                pitch = float(item.get("pitch", 1.0))',
    '                sound.set_editor_property("volume", volume)',
    '                sound.set_editor_property("pitch", pitch)',
    '                unreal.EditorAssetLibrary.save_loaded_asset(sound)',
    '                result["ok"] = True',
    '                result["detail"] = "已导入，音量 %.2f / 音调 %.2f" % (volume, pitch)',
    '        else:',
    '            result["ok"] = True',
    '            result["detail"] = "已导入"',
    'except Exception as error:',
    '    result["detail"] = str(error)',
    '',
    `unreal.log("${ITEM_RESULT_PREFIX}" + json.dumps(result, ensure_ascii=False))`,
    '',
  ].join('\n');
}

/** 把一段 CSV 灌进一张已存在的数据表 */
function buildTableScript(table) {
  return [
    '# -*- coding: utf-8 -*-',
    'import unreal',
    'import json',
    '',
    `item = json.loads(${embedData(table)})`,
    'result = {"ok": False, "detail": ""}',
    'try:',
    '    asset = unreal.load_asset(item["assetPath"])',
    '    if asset is None:',
    '        result["detail"] = "找不到数据表资产：" + item["assetPath"]',
    '    else:',
    '        filled = unreal.DataTableFunctionLibrary.fill_data_table_from_csv_file(',
    '            asset, item["csvPath"])',
    '        if filled:',
    '            unreal.EditorAssetLibrary.save_loaded_asset(asset)',
    '        result["ok"] = bool(filled)',
    '        result["detail"] = "已导入" if filled else "CSV 与数据表结构不匹配"',
    'except Exception as error:',
    '    result["detail"] = str(error)',
    '',
    `unreal.log("${ITEM_RESULT_PREFIX}" + json.dumps(result, ensure_ascii=False))`,
    '',
  ].join('\n');
}

/** 从脚本输出里取那一行结果 JSON；没有就当失败（脚本没跑到最后） */
function readItemResult(output) {
  for (const line of output) {
    const index = line.indexOf(ITEM_RESULT_PREFIX);
    if (index < 0) continue;
    try {
      const parsed = JSON.parse(line.slice(index + ITEM_RESULT_PREFIX.length));
      if (parsed === null || typeof parsed !== 'object') continue;
      return {
        ok: parsed.ok === true,
        detail: typeof parsed.detail === 'string' ? parsed.detail : '',
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** 进度回调出错不能把导入带崩 */
function report(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch {
    // 界面没了就不推了
  }
}

/**
 * 跑一轮导入。
 *
 * @param {object} options
 * @param {object} options.session UnrealRemoteSession
 * @param {string} options.nodeId 目标编辑器节点
 * @param {{tables: Array, images: Array, sounds: Array}} options.plan
 *   images / sounds 的每一项必须带 `sourcePath`（要导哪个本地文件）
 * @param {(event: object) => void} [options.onProgress]
 */
async function runImport({ session, nodeId, plan, onProgress }) {
  const tables = plan.tables ?? [];
  const assets = [
    ...(plan.images ?? []).map((item) => ({ kind: 'image', ...item })),
    ...(plan.sounds ?? []).map((item) => ({ kind: 'sound', ...item })),
  ];

  const items = [];
  const importedOwnerUids = [];
  const counts = {
    tables: tables.length,
    images: plan.images?.length ?? 0,
    sounds: plan.sounds?.length ?? 0,
  };

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'storymaker-ue-'));
  const channel = await session.openCommand(nodeId);

  try {
    // ---------- 阶段 1：素材 ----------
    const assetTotal = assets.length;
    for (let index = 0; index < assets.length; index += 1) {
      const task = assets[index];
      const position = { phase: 'assets', current: index + 1, total: assetTotal };

      report(onProgress, { ...position, label: task.id, status: 'running' });
      let outcome;
      try {
        const response = await channel.run(buildAssetScript(task), { timeoutMs: ASSET_TIMEOUT_MS });
        outcome = readItemResult(response.output);
      } catch (error) {
        outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }

      const ok = outcome !== null && outcome.ok;
      items.push({
        kind: task.kind,
        label: task.id,
        ok,
        detail: outcome === null ? '脚本没有回传结果' : outcome.detail,
      });
      if (ok) importedOwnerUids.push(task.ownerUid);
      report(onProgress, { ...position, label: task.id, status: ok ? 'ok' : 'failed' });
    }

    const failedAssets = items.filter((item) => !item.ok).length;
    if (failedAssets > 0) {
      return {
        stopped: true,
        items,
        importedOwnerUids,
        counts,
        message: `有 ${failedAssets} 个素材没导成功，数据表先不导——素材没进去就灌表会让引用指向不存在的资产。`,
      };
    }

    // ---------- 阶段 2：数据表 ----------
    const written = await writeCsvFiles(tables, tempDir);
    const tableTotal = written.length;
    for (let index = 0; index < written.length; index += 1) {
      const table = written[index];
      const position = { phase: 'tables', current: index + 1, total: tableTotal };

      report(onProgress, { ...position, label: table.label, status: 'running' });
      let outcome;
      try {
        const response = await channel.run(buildTableScript(table), { timeoutMs: TABLE_TIMEOUT_MS });
        outcome = readItemResult(response.output);
      } catch (error) {
        outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }

      const ok = outcome !== null && outcome.ok;
      items.push({
        kind: 'table',
        label: table.label,
        ok,
        detail: outcome === null ? '脚本没有回传结果' : outcome.detail,
      });
      report(onProgress, { ...position, label: table.label, status: ok ? 'ok' : 'failed' });
    }

    return { stopped: false, items, importedOwnerUids, counts };
  } finally {
    channel.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = {
  ASSET_TIMEOUT_MS,
  ITEM_RESULT_PREFIX,
  TABLE_TIMEOUT_MS,
  buildAssetScript,
  buildTableScript,
  readItemResult,
  runImport,
  writeCsvFiles,
};
