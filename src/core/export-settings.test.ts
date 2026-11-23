import { describe, expect, it } from 'vitest';

import { buildAllSheets } from './export';
import { EXPORT_SUBTABLES, dataTableRef, folderFromAssetPath } from './export-settings';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 样例里 TB_GAS_Ability 那一行 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_GAS_Ability', folder: 'GameContent/BP/GAS/GA', subTable: 'GAS技能' },
    { uid: 'x2', tableName: 'TB_Dialogue', folder: 'GameContent/BP/StorySystem', subTable: '对话' },
    { uid: 'x3', tableName: '  ', folder: 'GameContent/BP/空的', subTable: 'GAS武器' },
  ];
  return project;
}

describe('Unreal 导入设置', () => {
  it('数据表引用由「文件夹 + 表名」拼出来，和样例一致', () => {
    expect(dataTableRef('GameContent/BP/GAS/GA', 'TB_GAS_Ability')).toBe(
      "/Script/Engine.DataTable'/Game/GameContent/BP/GAS/GA/TB_GAS_Ability.TB_GAS_Ability'",
    );
    // 文件夹两头的斜杠、空格都容错
    expect(dataTableRef('/GameContent/BP/Pawn/', 'TB_Pawn')).toBe(
      "/Script/Engine.DataTable'/Game/GameContent/BP/Pawn/TB_Pawn.TB_Pawn'",
    );
    expect(dataTableRef('', 'TB_Pawn')).toBe("/Script/Engine.DataTable'/Game/TB_Pawn.TB_Pawn'");
    // 表名空着就不拼半截引用
    expect(dataTableRef('GameContent/BP/Pawn', '   ')).toBe('');
  });

  it('从编辑器给的资产路径里拆出「相对 /Game 的文件夹」', () => {
    expect(folderFromAssetPath('/Game/GameContent/BP/GAS/GA/TB_GAS_Ability')).toBe(
      'GameContent/BP/GAS/GA',
    );
    // 直接放在 /Game 根上的表
    expect(folderFromAssetPath('/Game/TB_Pawn')).toBe('');
    expect(folderFromAssetPath('')).toBe('');
  });

  it('子表清单就是导出预览上那一排子表，顺序也一样', () => {
    // 两边必须一模一样：导入设置里的「子表」列，选的就是预览里的子表名
    expect([...EXPORT_SUBTABLES]).toEqual(buildAllSheets(makeProject()).map((sheet) => sheet.name));
  });

  it('「导入设置」不再是子表，一共 16 张', () => {
    const sheets = buildAllSheets(makeProject());

    expect(sheets.map((sheet) => sheet.name)).toEqual([
      '对话',
      '选项',
      '本地化',
      '角色',
      '特殊指令',
      '图片',
      '音频',
      '物品',
      '文本框',
      'GASGameplayTags',
      'GAS属性',
      'GAS效果',
      'GAS技能',
      'GAS事件',
      'GAS角色',
      'GAS武器',
    ]);
    expect(sheets.some((sheet) => sheet.name === '导入设置')).toBe(false);
    // 每张子表都是「表头 + 若干数据行」，预览直接按这个渲染
    for (const sheet of sheets) expect(sheet.rows.length).toBeGreaterThan(0);
  });
});
