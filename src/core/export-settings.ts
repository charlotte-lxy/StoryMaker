/**
 * Unreal 导入设置。
 *
 * 策划原来在 Excel 里维护一张表：一张 DataTable 一行，写清楚它叫什么、放在哪个文件夹、
 * 内容来自哪个子表；「数据表引用」和「csv 文件路径」两列是公式算出来的。
 * 这里接管的就是那两列公式：
 *
 *   数据表引用 = /Script/Engine.DataTable'/Game/<文件夹>/<表名>.<表名>'
 *   csv 文件名 = TB_BSGame_<子表名>.csv
 */

import type { Project } from './types';

/**
 * 参与导出的子表清单：导入设置里「子表」那一列能选的就是这些。
 *
 * 名字沿用策划导入设置表里的写法（技能 / 脚本 这类），因为 csv 文件名是按它拼的
 * （TB_BSGame_技能.csv），换一套名字就对不上了。
 *
 * 本地化只有一个：剧本的对话选项文本与 UI 文案都写在「本地化」这张子表里，
 * 所以这里不拆成「本地化-脚本 / 本地化-UI」。
 */
export const EXPORT_SUBTABLES = [
  '技能',
  '效果',
  '属性',
  '事件',
  '角色',
  '武器',
  '脚本',
  '本地化',
] as const;

/** csv 文件名的前缀，和样例里的 TB_BSGame_技能.csv 一致 */
export const CSV_NAME_PREFIX = 'TB_BSGame_';

/** 导出时这一列的表头 */
export const IMPORT_SETTINGS_SHEET = '导入设置';
export const IMPORT_SETTINGS_HEADER: readonly string[] = ['', '数据表引用', 'csv文件路径'];

/** 去掉文件夹路径两头的斜杠，拼引用时统一成一个斜杠 */
function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, '');
}

/** 由「文件夹 + 表名」拼出 Unreal 里的数据表引用 */
export function dataTableRef(folder: string, tableName: string): string {
  const name = tableName.trim();
  if (name === '') return '';
  const path = normalizeFolder(folder);
  const full = path === '' ? name : `${path}/${name}`;
  return `/Script/Engine.DataTable'/Game/${full}.${name}'`;
}

/** 由子表名拼出导出后的 csv 文件名 */
export function csvFileName(subTable: string): string {
  const name = subTable.trim();
  return name === '' ? '' : `${CSV_NAME_PREFIX}${name}.csv`;
}

/** 「导入设置」子表的行：行名是数据表名，后两列是算出来的 */
export function buildImportSettingRows(project: Project): string[][] {
  return [
    [...IMPORT_SETTINGS_HEADER],
    ...project.exportSettings
      .filter((row) => row.tableName.trim() !== '')
      .map((row) => [
        row.tableName.trim(),
        dataTableRef(row.folder, row.tableName),
        csvFileName(row.subTable),
      ]),
  ];
}
