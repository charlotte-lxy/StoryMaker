import { describe, expect, it } from 'vitest';

import {
  buildUnrealImportPlan,
  packagePathOf,
  resolveImportAssets,
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

  it('图片和音效各按自己的分类路径拼出包路径，并带上条目 uid', () => {
    const plan = buildUnrealImportPlan(makeProject());
    expect(plan.images).toEqual([
      {
        ownerUid: 'img-1',
        id: 'SCE_Black',
        assetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
      },
    ]);
    expect(plan.sounds).toEqual([
      {
        ownerUid: 'snd-1',
        id: 'S_dididi',
        assetPath: '/Game/GameContent/Asset/Sound/BackgroundSound/S_dididi',
        volume: 1,
        pitch: 1,
      },
    ]);
  });

  it('音效的音量 / 音调带进计划', () => {
    const project = makeProject();
    project.sounds[0].volume = 1.4;
    project.sounds[0].pitch = 0.8;

    const plan = buildUnrealImportPlan(project);
    expect(plan.sounds[0]).toMatchObject({ volume: 1.4, pitch: 0.8 });
  });

  it('没选分类的图不进计划（导出去的表里那一格本来就是空的）', () => {
    const project = makeProject();
    project.images.push({ uid: 'img-2', id: 'SCE_No_Category', name: '没选分类' });
    const plan = buildUnrealImportPlan(project);
    expect(plan.images.map((image) => image.id)).toEqual(['SCE_Black']);
  });
});

describe('把素材对到实际文件上', () => {
  const file = (filePath: string, size = 100, mtimeMs = 1000) => ({
    filePath,
    fileName: filePath.split('\\').pop() ?? filePath,
    size,
    mtimeMs,
  });

  it('找得到文件就带上路径与指纹，找不到进 missing', () => {
    const byId = new Map([['SCE_Black', [file('C:\\素材\\SCE_Black.png')]]]);
    const result = resolveImportAssets(
      [
        { ownerUid: 'u1', id: 'SCE_Black', assetPath: '/Game/a/SCE_Black' },
        { ownerUid: 'u2', id: 'SCE_White', assetPath: '/Game/a/SCE_White' },
      ],
      byId,
      'image',
    );

    expect(result.ready).toEqual([
      {
        ownerUid: 'u1',
        id: 'SCE_Black',
        assetPath: '/Game/a/SCE_Black',
        kind: 'image',
        filePath: 'C:\\素材\\SCE_Black.png',
        fileName: 'SCE_Black.png',
        size: 100,
        mtimeMs: 1000,
      },
    ]);
    expect(result.missing).toEqual(['SCE_White']);
    expect(result.duplicates).toEqual([]);
  });

  it('同一个 ID 多个文件时用第一个并记进 duplicates', () => {
    const byId = new Map([
      ['SCE_Black', [file('C:\\素材\\SCE_Black.jpg'), file('C:\\素材\\SCE_Black.png')]],
    ]);
    const result = resolveImportAssets([{ ownerUid: 'u1', id: 'SCE_Black', assetPath: '/Game/a/SCE_Black' }], byId, 'image');

    expect(result.ready[0].fileName).toBe('SCE_Black.jpg');
    expect(result.duplicates).toEqual(['SCE_Black']);
  });

  it('结果按计划顺序，不受素材文件夹扫描顺序影响', () => {
    const byId = new Map([
      ['B', [file('C:\\素材\\B.png')]],
      ['A', [file('C:\\素材\\A.png')]],
    ]);
    const result = resolveImportAssets(
      [
        { ownerUid: 'uA', id: 'A', assetPath: '/Game/A' },
        { ownerUid: 'uB', id: 'B', assetPath: '/Game/B' },
      ],
      byId,
      'image',
    );
    expect(result.ready.map((item) => item.id)).toEqual(['A', 'B']);
  });
});