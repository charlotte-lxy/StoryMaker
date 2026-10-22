import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IMAGE_ASSET_ROOT,
  buildImageRows,
  defaultImageCategoryPath,
  imageAssetPath,
} from './image-export';
import { buildAllSheets } from './export';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 两行图：一行选了分类，一行没选 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.imageCategories = [
    { uid: 'cat-bg', name: '对话背景', path: '/Game/GameContent/Asset/Image/StoryBackground' },
    { uid: 'cat-cg', name: 'CG', path: '/Game/GameContent/Asset/Image/CG/' },
  ];
  project.images = [
    { uid: 'img-1', id: 'SCE_Black', name: '无背景-黑', categoryUid: 'cat-bg' },
    { uid: 'img-2', id: 'SCE_Home_001', name: '家里', categoryUid: 'cat-cg' },
    { uid: 'img-3', id: 'SCE_No_Category', name: '没选分类的图' },
  ];
  return project;
}

describe('图片资源路径', () => {
  it('拼成 /Script/Engine.Texture2D\'<分类路径>/<图片ID>.<图片ID>\'', () => {
    expect(imageAssetPath('/Game/GameContent/Asset/Image/StoryBackground', 'SCE_Black')).toBe(
      "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/StoryBackground/SCE_Black.SCE_Black'",
    );
  });

  it('分类路径末尾多写了斜杠也不出双斜杠', () => {
    expect(imageAssetPath('/Game/A/Image/CG/', 'SCE_1')).toBe(
      "/Script/Engine.Texture2D'/Game/A/Image/CG/SCE_1.SCE_1'",
    );
  });

  it('分类路径或图片 ID 缺一个就留空', () => {
    expect(imageAssetPath('', 'SCE_1')).toBe('');
    expect(imageAssetPath('/Game/A/Image', '  ')).toBe('');
  });

  it('新分类的默认存储路径是根目录 + 分类名', () => {
    expect(defaultImageCategoryPath('对话背景')).toBe(`${DEFAULT_IMAGE_ASSET_ROOT}/对话背景`);
    expect(DEFAULT_IMAGE_ASSET_ROOT).toBe('/Game/GameContent/Asset/Image');
  });
});

describe('「图片」子表', () => {
  it('表头是 行名 / 图片分类 / 备注 / 图片', () => {
    expect(buildImageRows(createEmptyProject())[0]).toEqual(['', '图片分类', '备注', '图片']);
  });

  it('没有图片时只有表头', () => {
    expect(buildImageRows(createEmptyProject())).toHaveLength(1);
  });

  it('一行一张图：行名是图片 ID，分类写分类名，备注写说明，图片按分类路径拼', () => {
    const rows = buildImageRows(makeProject());

    expect(rows.slice(1)).toEqual([
      [
        'SCE_Black',
        '对话背景',
        '无背景-黑',
        "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/StoryBackground/SCE_Black.SCE_Black'",
      ],
      [
        'SCE_Home_001',
        'CG',
        '家里',
        "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/CG/SCE_Home_001.SCE_Home_001'",
      ],
      // 没选分类：分类与图片两列都留空，由校验条提醒
      ['SCE_No_Category', '', '没选分类的图', ''],
    ]);
  });

  it('图片 ID 空着的行不导出', () => {
    const project = makeProject();
    project.images.push({ uid: 'img-4', id: '  ', name: '空 ID', categoryUid: 'cat-bg' });
    expect(buildImageRows(project)).toHaveLength(4);
  });

  it('导出的子表清单里有「图片」，紧跟在「特殊指令」后面', () => {
    const sheets = buildAllSheets(makeProject());
    const names = sheets.map((sheet) => sheet.name);
    expect(names.indexOf('图片')).toBe(names.indexOf('特殊指令') + 1);
  });
});
