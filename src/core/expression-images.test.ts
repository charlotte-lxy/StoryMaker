import { describe, expect, it } from 'vitest';

import {
  EXPRESSION_IMAGE_CATEGORY,
  collectExpressionImages,
  expressionPictureId,
} from './expression-images';
import { buildImageRows } from './image-export';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 一个角色（伊芙，有微笑/生气两个表情）+ 「角色立绘」分类 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.expressions = [
    { uid: 'ex-smile', name: '微笑', id: 'smile' },
    { uid: 'ex-angry', name: '生气', id: '' },
  ];
  project.characters = [
    {
      uid: 'ch1',
      id: 'CHA_伊芙',
      name: '伊芙',
      nameEn: '',
      nameJa: '',
      playPosition: '',
      aliases: [],
      expressions: ['微笑', '生气'],
      actions: [],
    },
  ];
  return project;
}

describe('表情图片 ID 与路径', () => {
  it('ID 是 PIC_角色ID-表情标识；标识没填就用表情名', () => {
    expect(expressionPictureId('CHA_伊芙', 'smile')).toBe('PIC_CHA_伊芙-smile');
    expect(expressionPictureId('CHA_伊芙', '')).toBe('');
    expect(expressionPictureId('', 'smile')).toBe('');
  });

  it('每个角色一个同名子文件夹：<分类路径>/<角色ID>/<图片ID>', () => {
    const [smile] = collectExpressionImages(makeProject());

    expect(smile.id).toBe('PIC_CHA_伊芙-smile');
    expect(smile.expression).toBe('微笑');
    expect(smile.categoryName).toBe(EXPRESSION_IMAGE_CATEGORY);
    expect(smile.path).toBe(
      "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/CharacterIllusion/CHA_伊芙/PIC_CHA_伊芙-smile.PIC_CHA_伊芙-smile'",
    );
    expect(smile.note).toBe('伊芙 · 微笑');
  });

  it('标识留空的表情用表情名拼 ID', () => {
    const images = collectExpressionImages(makeProject());
    expect(images[1].id).toBe('PIC_CHA_伊芙-生气');
    expect(images[1].expression).toBe('生气');
  });

  it('角色没有 ID、或没勾表情时不收；表情表里有、角色没勾的也不收', () => {
    const project = makeProject();
    project.characters[0].expressions = [];
    expect(collectExpressionImages(project)).toEqual([]);

    project.characters[0].expressions = ['微笑'];
    project.characters[0].id = '  ';
    expect(collectExpressionImages(project)).toEqual([]);
  });

  it('分类被改名 / 改路径：路径跟着分类走', () => {
    const project = makeProject();
    project.imageCategories = [
      { uid: 'cat-1', name: '角色表情', path: '/Game/Art/Chars', system: 'expressionImages' },
    ];
    const images = collectExpressionImages(project);
    expect(images[0].categoryName).toBe('角色表情');
    expect(images[0].path).toBe(
      "/Script/Engine.Texture2D'/Game/Art/Chars/CHA_伊芙/PIC_CHA_伊芙-smile.PIC_CHA_伊芙-smile'",
    );
  });
});

describe('表情图片进「图片」子表', () => {
  it('接在手填的图片后面，四列都齐', () => {
    const project = makeProject();
    project.images = [{ uid: 'img-1', id: 'SCE_Black', name: '黑屏' }];

    const rows = buildImageRows(project);
    expect(rows[0]).toEqual(['', '图片分类', '备注', '图片']);
    expect(rows.slice(1).map((row) => row[0])).toEqual([
      'SCE_Black',
      'PIC_CHA_伊芙-smile',
      'PIC_CHA_伊芙-生气',
    ]);
    expect(rows[2]).toEqual([
      'PIC_CHA_伊芙-smile',
      '角色立绘',
      '伊芙 · 微笑',
      "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/CharacterIllusion/CHA_伊芙/PIC_CHA_伊芙-smile.PIC_CHA_伊芙-smile'",
    ]);
  });

  it('手填图片里已经有同名 ID 时，以手填那行为准、不重复', () => {
    const project = makeProject();
    project.images = [
      { uid: 'img-1', id: 'PIC_CHA_伊芙-smile', name: '手工指定的图', categoryUid: 'cat-x' },
    ];
    project.imageCategories.push({ uid: 'cat-x', name: '手填', path: '/Game/Manual' });

    const rows = buildImageRows(project).slice(1);
    expect(rows.filter((row) => row[0] === 'PIC_CHA_伊芙-smile')).toEqual([
      [
        'PIC_CHA_伊芙-smile',
        '手填',
        '手工指定的图',
        "/Script/Engine.Texture2D'/Game/Manual/PIC_CHA_伊芙-smile.PIC_CHA_伊芙-smile'",
      ],
    ]);
  });
});
