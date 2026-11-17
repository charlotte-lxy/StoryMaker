import { describe, expect, it } from 'vitest';

import {
  buildUnrealImportPlan,
  packagePathOf,
  parseImportResult,
} from './unreal-import';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 配两张数据表（其中一张是「导入设置」自己，应当跳过），外加一条图、一条音效 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_Dialogue', folder: 'GameContent/BP/StorySystem', subTable: '对话' },
    { uid: 'x2', tableName: 'TB_Image', folder: 'GameContent/BP/Image', subTable: '图片' },
    { uid: 'x3', tableName: 'TB_Columns', folder: 'GameContent/BP', subTable: '导入设置' },
    { uid: 'x4', tableName: '   ', folder: 'GameContent/BP', subTable: '音频' },
  ];
  project.imageCategories = [
    { uid: 'cat-bg', name: '对话背景', path: '/Game/GameContent/Asset/Image/StoryBackground' },
  ];
  project.images = [
    { uid: 'img-1', id: 'SCE_Black', name: '无背景-黑', categoryUid: 'cat-bg' },
  ];
  project.soundCategories = [
    { uid: 'cat-sfx', name: '音效', path: '/Game/GameContent/Asset/Sound/BackgroundSound' },
  ];
  project.sounds = [{ uid: 'snd-1', id: 'S_dididi', name: '滴滴滴', categoryUid: 'cat-sfx' }];
  return project;
}

describe('把导出的资源引用拆成包路径', () => {
  it('去掉 /Script/Engine.Xxx\'…\' 外壳和末尾的 .名字', () => {
    expect(
      packagePathOf("/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/Bg/SCE_Black.SCE_Black'"),
    ).toBe('/Game/GameContent/Asset/Image/Bg/SCE_Black');
    expect(
      packagePathOf("/Script/Engine.SoundWave'/Game/GameContent/Asset/Sound/S_dididi.S_dididi'"),
    ).toBe('/Game/GameContent/Asset/Sound/S_dididi');
    expect(
      packagePathOf("/Script/Engine.DataTable'/Game/GameContent/BP/TB_Dialogue.TB_Dialogue'"),
    ).toBe('/Game/GameContent/BP/TB_Dialogue');
  });

  it('不是这种引用就返回空串，让调用方跳过它', () => {
    expect(packagePathOf('')).toBe('');
    expect(packagePathOf('/Game/GameContent/Asset/Image/Bg/SCE_Black')).toBe('');
    expect(packagePathOf('随便一段文字')).toBe('');
  });
});

describe('导入计划', () => {
  it('只导「导入设置」里配了的表，跳过它自己那张', () => {
    const plan = buildUnrealImportPlan(makeProject());
    expect(plan.tables.map((table) => table.label)).toEqual(['TB_Dialogue', 'TB_Image']);
    expect(plan.tables[0].assetPath).toBe('/Game/GameContent/BP/StorySystem/TB_Dialogue');
  });

  it('CSV 内容取自对应子表，第一行是表头', () => {
    const plan = buildUnrealImportPlan(makeProject());
    const dialogue = plan.tables[0];
    expect(dialogue.csvText.split('\r\n')[0]).toContain('文本类型');
  });

  it('图片和音效各按自己的分类路径拼出包路径', () => {
    const plan = buildUnrealImportPlan(makeProject());
    expect(plan.images).toEqual([
      {
        id: 'SCE_Black',
        assetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
      },
    ]);
    expect(plan.sounds).toEqual([
      {
        id: 'S_dididi',
        assetPath: '/Game/GameContent/Asset/Sound/BackgroundSound/S_dididi',
      },
    ]);
  });

  it('没选分类的图不进计划（导出去的表里那一格本来就是空的）', () => {
    const project = makeProject();
    project.images.push({ uid: 'img-2', id: 'SCE_No_Category', name: '没选分类' });
    const plan = buildUnrealImportPlan(project);
    expect(plan.images.map((image) => image.id)).toEqual(['SCE_Black']);
  });
});

describe('解析 UE 回传的导入结果', () => {
  it('从一堆 UE 日志里挑出那一行结果 JSON', () => {
    const output = [
      'LogPython: 别的日志',
      'LogPython: SMK_IMPORT_RESULT [{"kind":"table","label":"TB_Image","ok":true,"detail":"已导入"}]',
      'LogPython: SMK_IMPORT_DONE',
    ];
    expect(parseImportResult(output)).toEqual([
      { kind: 'table', label: 'TB_Image', ok: true, detail: '已导入' },
    ]);
  });

  it('没有结果行、JSON 坏了、或字段不对都返回 null', () => {
    expect(parseImportResult(['只有日志'])).toBeNull();
    expect(parseImportResult(['SMK_IMPORT_RESULT 这不是 JSON'])).toBeNull();
    expect(parseImportResult(['SMK_IMPORT_RESULT {"kind":"table"}'])).toBeNull();
  });

  it('丢掉不认识 kind 的条目，其余照收', () => {
    const output = [
      'SMK_IMPORT_RESULT [{"kind":"unknown","label":"x","ok":true,"detail":""},{"kind":"image","label":"SCE_Black","ok":false,"detail":"导入没有产出资产"}]',
    ];
    expect(parseImportResult(output)).toEqual([
      { kind: 'image', label: 'SCE_Black', ok: false, detail: '导入没有产出资产' },
    ]);
  });
});
