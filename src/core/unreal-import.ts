/**
 * 「导入到 Unreal」要导的东西：一份纯数据的计划。
 *
 * 这里只负责把项目整理成任务清单——哪些 DataTable 对应哪段 CSV、哪张图/哪个音效
 * 该落到哪个资源路径。真正的网络通信和写文件在主进程（electron/unreal-*.cjs），
 * 界面拿到计划后交给宿主执行。这样本模块全是纯函数，能直接测。
 *
 * 每个素材都带 `ownerUid`（条目的 uid）：素材跟条目走，不跟文件名走。
 */

import { toCsv } from './csv';
import { buildAllSheets } from './export';
import { IMPORT_SETTINGS_SHEET, dataTableRef } from './export-settings';
import { collectExpressionImages } from './expression-images';
import { imageAssetPath } from './image-export';
import { soundAssetPath } from './sound-export';
import { collectWeaponIcons } from './weapon-icons';
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
  /** 条目 uid：改 ID 之后素材还能靠它认回来 */
  ownerUid: string;
  /** 素材名（= 文件名不含扩展名），也是 UE 里的资产名 */
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
  ownerUid: string;
  id: string;
  assetPath: string;
  kind: 'image' | 'sound';
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
 * 图片：手填的在前，表情立绘、武器图标接在后面——顺序和导出「图片」子表一致，
 * 同 ID 的手填行优先（和导出时的去重规则一样）。
 */
function collectImageTasks(project: Project): AssetImportTask[] {
  const categories = new Map(project.imageCategories.map((row) => [row.uid, row]));
  const tasks: AssetImportTask[] = [];
  const taken = new Set<string>();

  for (const row of project.images) {
    const id = row.id.trim();
    if (id === '') continue;
    const category = categories.get(row.categoryUid ?? '');
    const assetPath = packagePathOf(imageAssetPath(category?.path ?? '', id));
    if (assetPath === '') continue;
    tasks.push({ ownerUid: row.uid, id, assetPath });
    taken.add(id);
  }

  for (const image of collectExpressionImages(project)) {
    if (taken.has(image.id)) continue;
    taken.add(image.id);
    const assetPath = packagePathOf(image.path);
    if (assetPath === '') continue;
    tasks.push({ ownerUid: image.ownerUid, id: image.id, assetPath });
  }

  for (const icon of collectWeaponIcons(project)) {
    if (taken.has(icon.id)) continue;
    taken.add(icon.id);
    const assetPath = packagePathOf(icon.path);
    if (assetPath === '') continue;
    // 武器图标跟武器行绑定：改武器 ID 时图标跟着改名
    tasks.push({ ownerUid: icon.weaponUid, id: icon.id, assetPath });
  }

  return tasks;
}

/** 音效：一行一条，id 空着或没选类型的跳过（和导出一致） */
function collectSoundTasks(project: Project): AssetImportTask[] {
  const categories = new Map(project.soundCategories.map((row) => [row.uid, row]));
  const tasks: AssetImportTask[] = [];

  for (const row of project.sounds) {
    const id = row.id.trim();
    if (id === '') continue;
    const category = categories.get(row.categoryUid ?? '');
    const assetPath = packagePathOf(soundAssetPath(category?.path ?? '', id));
    if (assetPath === '') continue;
    tasks.push({ ownerUid: row.uid, id, assetPath });
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
    images: collectImageTasks(project),
    sounds: collectSoundTasks(project),
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
  kind: 'image' | 'sound',
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
      ownerUid: task.ownerUid,
      id: task.id,
      assetPath: task.assetPath,
      kind,
      filePath: file.filePath,
      fileName: file.fileName,
      size: file.size,
      mtimeMs: file.mtimeMs,
    });
  }

  return { ready, missing, duplicates };
}
