'use strict';

/**
 * 从编辑器里检索「有哪些数据表」「有哪些文件夹」。
 *
 * 「Unreal 导入设置」页用这两份清单：
 *   - 数据表：让策划从下拉里选，不用手填表名和文件夹
 *   - 文件夹：前缀配置从树里点一个目录，前缀自动拼出来
 *
 * 一次跑完一份，连一次编辑器取完缓存住；点了「重新检测」才重查。
 */

const CATALOG_PREFIX = 'SMK_CATALOG ';

/** 只查 /Game 下；DataTable 走 AssetRegistry，比逐个 load 快得多 */
function buildCatalogScript() {
  return [
    '# -*- coding: utf-8 -*-',
    'import unreal',
    'import json',
    '',
    'tables = []',
    'folders = set()',
    '',
    'def add_table(package_path):',
    '    folder = package_path.rsplit("/", 1)[0]',
    '    name = package_path.rsplit("/", 1)[-1]',
    '    if name != "":',
    '        tables.append({"name": name, "path": package_path, "folder": folder})',
    '',
    '# 数据表：AssetRegistry 按类过滤，不加载资产',
    'try:',
    '    registry = unreal.AssetRegistryHelpers.get_asset_registry()',
    '    asset_filter = unreal.ARFilter(',
    '        class_paths=[unreal.TopLevelAssetPath("/Script/Engine", "DataTable")],',
    '        recursive_paths=True,',
    '        package_paths=["/Game"],',
    '    )',
    '    for asset in registry.get_assets(asset_filter):',
    '        add_table(str(asset.package_name))',
    'except Exception as error:',
    '    unreal.log("SMK_CATALOG_WARN registry: " + str(error))',
    '',
    '# 文件夹：list_assets 里没有扩展名的那一项就是目录',
    'for path in unreal.EditorAssetLibrary.list_assets("/Game", recursive=True, include_folder=True):',
    '    leaf = path.rsplit("/", 1)[-1]',
    '    if "." not in leaf:',
    '        folders.add(path)',
    '',
    'unreal.log("SMK_CATALOG " + json.dumps(',
    '    {"dataTables": tables, "folders": sorted(folders)}, ensure_ascii=False))',
    '',
  ].join('\n');
}

/** 从脚本输出里取那一行 JSON；没有就返回 null */
function readCatalog(output) {
  for (const line of output) {
    const index = line.indexOf(CATALOG_PREFIX);
    if (index < 0) continue;
    try {
      const parsed = JSON.parse(line.slice(index + CATALOG_PREFIX.length));
      if (parsed === null || typeof parsed !== 'object') continue;
      return {
        dataTables: Array.isArray(parsed.dataTables) ? parsed.dataTables : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 连上编辑器查一次清单。
 *
 * @param {object} session UnrealRemoteSession
 * @param {string} nodeId
 */
async function queryUnrealCatalog(session, nodeId) {
  const result = await session.runScript(nodeId, buildCatalogScript(), { timeoutMs: 180_000 });
  return readCatalog(result.output);
}

module.exports = {
  CATALOG_PREFIX,
  buildCatalogScript,
  queryUnrealCatalog,
  readCatalog,
};
