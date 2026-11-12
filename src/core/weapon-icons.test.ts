import { describe, expect, it } from 'vitest';

import { collectWeaponIcons, weaponIconId } from './weapon-icons';
import { buildImageRows } from './image-export';
import { createEmptyProject } from '../state/operations';
import type { Project } from './types';

/** 两把武器 + 「武器图标」分类 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.battle.weapons = [
    {
      uid: 'w1',
      id: 'WEA_测试-手枪',
      name: '测试-手枪',
      description: '',
      nameEn: '',
      nameJa: '',
      descriptionEn: '',
      descriptionJa: '',
      magazine: '10',
      attackSpeed: '1',
      energyCost: '0',
      attackModeUids: [],
      slotUids: [],
    },
    {
      uid: 'w2',
      id: 'WEA_测试-刀',
      name: '',
      description: '',
      nameEn: '',
      nameJa: '',
      descriptionEn: '',
      descriptionJa: '',
      magazine: '-1',
      attackSpeed: '1',
      energyCost: '0',
      attackModeUids: [],
      slotUids: [],
    },
  ];
  return project;
}

describe('武器图标', () => {
  it('图片 ID 是 PIC_<武器ID>', () => {
    expect(weaponIconId('WEA_测试-手枪')).toBe('PIC_WEA_测试-手枪');
    expect(weaponIconId('  ')).toBe('');
  });

  it('每把武器一条：分类「武器图标」，路径是分类路径 + 图片 ID（不再分子文件夹）', () => {
    const icons = collectWeaponIcons(makeProject());
    expect(icons.map((icon) => icon.id)).toEqual([
      'PIC_WEA_测试-手枪',
      'PIC_WEA_测试-刀',
    ]);
    expect(icons[0]).toMatchObject({
      weaponId: 'WEA_测试-手枪',
      weaponName: '测试-手枪',
      categoryName: '武器图标',
      note: '测试-手枪',
    });
    expect(icons[0].path).toBe(
      "/Script/Engine.Texture2D'/Game/GameContent/Asset/Image/WeaponIcon/PIC_WEA_测试-手枪.PIC_WEA_测试-手枪'",
    );
    // 没填名字的武器，备注用 ID
    expect(icons[1].note).toBe('WEA_测试-刀');
  });

  it('武器 ID 空着的不收', () => {
    const project = makeProject();
    project.battle.weapons[0].id = '  ';
    expect(collectWeaponIcons(project).map((icon) => icon.id)).toEqual(['PIC_WEA_测试-刀']);
  });

  it('分类被改名 / 改路径：图标路径跟着分类走', () => {
    const project = makeProject();
    project.imageCategories = project.imageCategories.map((row) =>
      row.system === 'weaponIcons'
        ? { ...row, name: '武器图标（旧）', path: '/Game/Art/Weapons' }
        : row,
    );
    const icons = collectWeaponIcons(project);
    expect(icons[0].categoryName).toBe('武器图标（旧）');
    expect(icons[0].path).toBe(
      "/Script/Engine.Texture2D'/Game/Art/Weapons/PIC_WEA_测试-手枪.PIC_WEA_测试-手枪'",
    );
  });

  it('接在「图片」子表的最后（表情图片之后）', () => {
    const project = makeProject();
    project.characters = [
      {
        uid: 'ch1',
        id: 'CHA_伊芙',
        name: '伊芙',
        nameEn: '',
        nameJa: '',
        playPosition: '',
        aliases: [],
        expressions: ['微笑'],
        actions: [],
      },
    ];
    project.expressions = [{ uid: 'ex1', name: '微笑', id: '微笑' }];

    const ids = buildImageRows(project).slice(1).map((row) => row[0]);
    expect(ids).toEqual([
      'PIC_CHA_伊芙-微笑',
      'PIC_WEA_测试-手枪',
      'PIC_WEA_测试-刀',
    ]);
  });
});
