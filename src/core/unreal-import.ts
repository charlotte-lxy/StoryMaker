/**
 * 「导入到 Unreal」要导的东西：一份纯数据的计划。
 *
 * 这里只负责把项目整理成任务清单——哪些 DataTable 对应哪段 CSV、哪张图/哪个音效
 * 该落到哪个资源路径。真正的网络通信和写文件在主进程（electron/unreal-*.cjs），
 * 界面拿到计划后交给宿主执行。这样本模块全是纯函数，能直接测。
 */

import { toCsv } from './csv';
import { buildAllSheets } from './export';
import { IMPORT_SETTINGS_SHEET, dataTableRef } from './export-settings';
import { buildImageRows } from './image-export';
import { buildSoundRows } from './sound-export';
import type { Project } from './types';

/** 一张要导入的数据表 */
export interface TableImportTask {
  /** 界面显示的名字，就是数据表名 */
  label: string;
  /** Unreal 包路径，如 /Game/GameContent/BP/StorySystem/TB_Dialogue */
  assetPath: string;
  /** CSV 文本（不带 BOM，UE 的 CSV 解析对 BOM 敏感） */
  csvText: string;
}

/** 一张图 / 一条音效 */
export interface AssetImportTask {
  /** 图片 ID 或音效 ID；也是素材文件名（不含扩展名）要匹配的东西 */
  id: string;
  /** Unreal 包路径，如 /Game/GameContent/Asset/Image/StoryBackground/SCE_Black */
  assetPath: string;
}

export interface UnrealImportPlan {
  tables: TableImportTask[];
  images: AssetImportTask[];
  sounds: AssetImportTask[];
}

/** 素材文件夹里的一个文件，只需要判定要用的那几项 */
export interface MaterialFileRef {
  filePath: string;
  fileName: string;
  size: number;
  mtimeMs: number;
}

/** 解析出来的、真的可以导的一个素材 */
export interface ResolvedImportAsset extends MaterialFileRef {
  id: string;
  assetPath: string;
}

export interface ResolvedAssets {
  /** 素材文件夹里有对应文件的，按计划顺序 */
  ready: ResolvedImportAsset[];
  /** 计划里有、素材文件夹里找不到文件 */
  missing: string[];
  /** 同一个 ID 找到多个文件的（导入时用第一个） */
  duplicates: string[];
}

const ASSET_REF_PATTERN = /^\/Script\/Engine\.\w+'(.+)'$/;

/**
 * 把 `/Script/Engine.Texture2D'/Game/a/b.X.X'` 拆成包路径 `/Game/a/b.X`。
 *
 * 导出表里写的是带引号的完整引用，导入时要的是包路径。
 * 解析不出来返回空串，调用方据此跳过（不该把它当成一个合法路径）。
 */
export function packagePathOf(assetRef: string): string {
  const text = assetRef.trim();
  const match = ASSET_REF_PATTERN.exec(text);
  if (match === null) return '';
  const inner = match[1];
  const dot = inner.lastIndexOf('.');
  return dot < 0 ? inner : inner.slice(0, dot);
}

/**
 * 从一张导出子表的「资源列」里收 id + 包路径。
 *
 * @param rows 整张子表（第一行是表头）
 * @param column 资源列的下标
 */
function collectAssets(rows: string[][], column: number): AssetImportTask[] {
  const tasks: AssetImportTask[] = [];
  for (const row of rows.slice(1)) {
    const id = (row[0] ?? '').trim();
    const assetPath = packagePathOf(row[column] ?? '');
    if (id === '' || assetPath === '') continue;
    tasks.push({ id, assetPath });
  }
  return tasks;
}

/**
 * 把项目整理成一份导入计划。
 *
 * 数据表以「Unreal 导入设置」里配的那些行为准：没配的表不导（比如物品表就没配），
 * 「导入设置」自己那张子表也不是 DataTable，跳过。
 */
export function buildUnrealImportPlan(project: Project): UnrealImportPlan {
  const sheets = new Map(buildAllSheets(project).map((sheet) => [sheet.name, sheet.rows]));

  const tables: TableImportTask[] = [];
  for (const row of project.exportSettings) {
    const tableName = row.tableName.trim();
    const subTable = row.subTable.trim();
    if (tableName === '' || subTable === '') continue;
    // 「导入设置」子表是给策划看的配置表，UE 里没有对应的 DataTable
    if (subTable === IMPORT_SETTINGS_SHEET) continue;
    const rows = sheets.get(subTable);
    if (rows === undefined) continue;
    tables.push({
      label: tableName,
      assetPath: packagePathOf(dataTableRef(row.folder, tableName)),
      csvText: toCsv(rows),
    });
  }

  return {
    tables,
    images: collectAssets(buildImageRows(project), 3),
    sounds: collectAssets(buildSoundRows(project), 1),
  };
}

/**
 * 把计划里的素材对到素材文件夹里的实际文件上。
 *
 * 同一个 ID 有多个文件时用第一个（按文件名排序），并记进 `duplicates` 提示用户去删。
 */
export function resolveImportAssets(
  tasks: readonly AssetImportTask[],
  byId: ReadonlyMap<string, readonly MaterialFileRef[]>,
): ResolvedAssets {
  const ready: ResolvedImportAsset[] = [];
  const missing: string[] = [];
  const duplicates: string[] = [];

  for (const task of tasks) {
    const files = byId.get(task.id) ?? [];
    if (files.length === 0) {
      missing.push(task.id);
      continue;
    }
    if (files.length > 1) duplicates.push(task.id);
    const file = files[0];
    ready.push({
      id: task.id,
      assetPath: task.assetPath,
      filePath: file.filePath,
      fileName: file.fileName,
      size: file.size,
      mtimeMs: file.mtimeMs,
    });
  }

  return { ready, missing, duplicates };
}
