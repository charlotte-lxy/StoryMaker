/**
 * Unreal 导入设置。
 *
 * 一张 DataTable 一行：选它对应哪个数据表资产、内容来自哪个子表。
 * 「数据表引用」由「文件夹 + 表名」拼出来（数据表本身就是从编辑器里选的，
 * 这两项已经自动填好，不需要策划手写）。
 *
 *   数据表引用 = /Script/Engine.DataTable'/Game/<文件夹>/<表名>.<表名>'
 *
 * 「导入设置」这张子表已经取消：它原来只是给策划核对导入映射用的，
 * 现在配置直接就是导入时用的那份数据，没必要再导出一次。
 */

/**
 * 参与导出的子表清单：导入设置里「子表」那一列能选的就是这些。
 *
 * 名字必须和「导出预览」上那一排子表按钮一模一样（来自 buildAllSheets），
 * 策划一眼就能对上"这行数据是从哪张子表来的"。两边由 export-settings.test.ts
 * 里的一条测试钉住，别各改各的。
 */
export const EXPORT_SUBTABLES = [
  '对话',
  '选项',
  '本地化',
  '角色',
  '特殊指令',
  '图片',
  '音频',
  '物品',
  'GASGameplayTags',
  'GAS属性',
  'GAS效果',
  'GAS技能',
  'GAS事件',
  'GAS角色',
  'GAS武器',
] as const;

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

/**
 * 从编辑器给的数据表路径拆出「相对 /Game 的文件夹」。
 *
 * 下拉里选的是 `/Game/GameContent/BP/StorySystem/TB_Dialogue`，
 * 项目里存的是 `GameContent/BP/StorySystem`（和 dataTableRef 的拼法对齐）。
 */
export function folderFromAssetPath(assetPath: string): string {
  const path = assetPath.trim();
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return '';
  const folder = path.slice(0, slash);
  // 直接放在 /Game 根上的表：相对的文件夹就是空的
  if (folder === '/Game') return '';
  return folder.startsWith('/Game/') ? folder.slice('/Game/'.length) : folder.replace(/^\/+/, '');
}
