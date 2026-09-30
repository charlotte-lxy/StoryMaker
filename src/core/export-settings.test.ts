import { describe, expect, it } from 'vitest';

import { buildAllSheets } from './export';
import {
  EXPORT_SUBTABLES,
  IMPORT_SETTINGS_HEADER,
  buildImportSettingRows,
  csvFileName,
  dataTableRef,
} from './export-settings';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 样例里 TB_GAS_Ability 那一行 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_GAS_Ability', folder: 'GameContent/BP/GAS/GA', subTable: '技能' },
    { uid: 'x2', tableName: 'TB_Dialogue', folder: 'GameContent/BP/StorySystem', subTable: '脚本' },
    { uid: 'x3', tableName: 'TB_LocalText_Widget', folder: 'GameContent/BP/LocalText', subTable: '本地化-UI' },
    { uid: 'x4', tableName: '  ', folder: 'GameContent/BP/空的', subTable: '武器' },
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

  it('csv 文件名由子表名拼出来', () => {
    expect(csvFileName('GAS技能')).toBe('TB_BSGame_GAS技能.csv');
    expect(csvFileName('本地化')).toBe('TB_BSGame_本地化.csv');
    expect(csvFileName('  ')).toBe('');
  });

  it('子表清单就是导出预览上那一排子表，顺序也一样', () => {
    // 两边必须一模一样：导入设置里的「子表」列，选的就是预览里的子表名
    expect([...EXPORT_SUBTABLES]).toEqual(buildAllSheets(makeProject()).map((sheet) => sheet.name));
  });

  it('导入设置子表：行名是数据表名，只导出算出来的两列，表名空的行不进表', () => {
    const rows = buildImportSettingRows(makeProject());

    expect(rows[0]).toEqual([...IMPORT_SETTINGS_HEADER]);
    expect(rows).toHaveLength(4); // 表头 + 3 条（表名空的那条被跳过）
    expect(rows[1]).toEqual([
      'TB_GAS_Ability',
      "/Script/Engine.DataTable'/Game/GameContent/BP/GAS/GA/TB_GAS_Ability.TB_GAS_Ability'",
      'TB_BSGame_技能.csv',
    ]);
    expect(rows[3][2]).toBe('TB_BSGame_本地化-UI.csv');
  });

  it('导入设置排在所有子表最后，一共 12 张', () => {
    const sheets = buildAllSheets(makeProject());

    expect(sheets.map((sheet) => sheet.name)).toEqual([
      '对话',
      '选项',
      '本地化',
      '角色',
      'GASGameplayTags',
      'GAS属性',
      'GAS效果',
      'GAS技能',
      'GAS事件',
      'GAS角色',
      'GAS武器',
      '导入设置',
    ]);
    // 每张子表都是「表头 + 若干数据行」，预览直接按这个渲染
    for (const sheet of sheets) expect(sheet.rows.length).toBeGreaterThan(0);
  });
});
