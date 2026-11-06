import { describe, expect, it } from 'vitest';

import {
  addBattleRow,
  addCharacterWeapon,
  addWeaponOption,
  removeCharacterWeapon,
  removeWeaponOption,
  updateBattleList,
  updateCharacterWeapon,
  updateWeaponOption,
  updateWeaponOptionNameText,
} from './battle-operations';
import type { Project } from '../core/types';
import { createEmptyProject } from './operations';

/** 空项目 + 一把武器 */
function makeProject() {
  return addBattleRow(createEmptyProject(), 'weapons');
}

describe('武器的攻击模式 / 插槽配置', () => {
  it('新增配置：显示名称不重，导出名称先等于显示名称', () => {
    const project = addWeaponOption(addWeaponOption(makeProject(), 'attackModes'), 'attackModes');
    expect(project.battle.attackModes.map((row) => [row.name, row.exportName])).toEqual([
      ['新攻击模式', '新攻击模式'],
      ['新攻击模式2', '新攻击模式2'],
    ]);

    const slots = addWeaponOption(project, 'slots');
    expect(slots.battle.slots.map((row) => row.name)).toEqual(['新插槽']);
  });

  it('改显示名称 / 导出名称：各改各的', () => {
    const project = addWeaponOption(makeProject(), 'attackModes');
    const uid = project.battle.attackModes[0].uid;

    const named = updateWeaponOption(project, 'attackModes', uid, { name: '手动攻击' });
    expect(named.battle.attackModes[0]).toMatchObject({ name: '手动攻击', exportName: '新攻击模式' });

    const exported = updateWeaponOption(named, 'attackModes', uid, {
      exportName: 'TXT_AttackMode_手动攻击',
    });
    expect(exported.battle.attackModes[0]).toMatchObject({
      name: '手动攻击',
      exportName: 'TXT_AttackMode_手动攻击',
    });
  });

  it('删一条配置：武器里勾过它的也一起摘掉', () => {
    let project = addWeaponOption(addWeaponOption(makeProject(), 'slots'), 'slots');
    const [first, second] = project.battle.slots;
    const weaponUid = project.battle.weapons[0].uid;
    project = updateBattleList(project, 'weapons', weaponUid, 'slotUids', [first.uid, second.uid]);

    const next = removeWeaponOption(project, 'slots', first.uid);
    expect(next.battle.slots.map((row) => row.uid)).toEqual([second.uid]);
    expect(next.battle.weapons[0].slotUids).toEqual([second.uid]);
  });

  it('多选列表存 uid，改名字不会把引用写坏', () => {
    let project = addWeaponOption(makeProject(), 'attackModes');
    const uid = project.battle.attackModes[0].uid;
    const weaponUid = project.battle.weapons[0].uid;
    project = updateBattleList(project, 'weapons', weaponUid, 'attackModeUids', [uid]);

    const renamed = updateWeaponOption(project, 'attackModes', uid, { name: '自动攻击' });
    expect(renamed.battle.weapons[0].attackModeUids).toEqual([uid]);
  });

  it('新武器默认没有勾任何攻击模式 / 插槽', () => {
    const project = makeProject();
    expect(project.battle.weapons[0].attackModeUids).toEqual([]);
    expect(project.battle.weapons[0].slotUids).toEqual([]);
  });
});

describe('角色预设带的武器', () => {
  /** 两把武器 + 一条插槽 + 一个攻击模式，角色身上还什么都没带 */
  function makeWeaponProject(): Project {
    const project = createEmptyProject();
    project.battle.weapons = [
      {
        uid: 'w1',
        id: 'WEA_测试-手枪',
        name: '测试-手枪',
        description: '',
        magazine: '10',
        attackSpeed: '1',
        energyCost: '0',
        attackModeUids: [],
        slotUids: [],
      },
      {
        uid: 'w2',
        id: 'WEA_测试-刀',
        name: '测试-刀',
        description: '',
        magazine: '-1',
        attackSpeed: '1',
        energyCost: '0',
        attackModeUids: [],
        slotUids: [],
      },
    ];
    project.battle.slots = [{ uid: 'sl1', name: '右手', exportName: 'TXT_WeaponTeamSlot_右手', nameEn: '', nameJa: '' }];
    project.battle.attackModes = [
      { uid: 'am1', name: '手动攻击', exportName: 'TXT_AttackMode_手动攻击', nameEn: '', nameJa: '' },
    ];
    project.battle.characters = [
      {
        uid: 'ch1',
        id: 'CHA_伊芙',
        name: '伊芙',
        attributes: [],
        skillUids: [],
        weapons: [],
      },
    ];
    return project;
  }

  it('新增一把：默认第一把武器 + 火力分组 + 第一个插槽与攻击模式', () => {
    const project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entry = project.battle.characters[0].weapons[0];
    expect(entry.weaponUid).toBe('w1');
    expect(entry.slotUid).toBe('sl1');
    expect(entry.attackModeUid).toBe('am1');
    // 分组默认「火力」
    const fire = project.battle.weaponGroups.find((row) => row.name === '火力')!;
    expect(entry.groupUid).toBe(fire.uid);
  });

  it('改四个下拉：按条目 uid 改，删一把只动那一条', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    project = addCharacterWeapon(project, 'ch1');
    const [first, second] = project.battle.characters[0].weapons;

    project = updateCharacterWeapon(project, second.uid, { weaponUid: 'w2' });
    expect(project.battle.characters[0].weapons.map((row) => row.weaponUid)).toEqual(['w1', 'w2']);

    project = removeCharacterWeapon(project, 'ch1', first.uid);
    expect(project.battle.characters[0].weapons.map((row) => row.uid)).toEqual([second.uid]);
  });

  it('删掉分组 / 插槽：角色身上对应的那一格清空', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entry = project.battle.characters[0].weapons[0];

    project = removeWeaponOption(project, 'weaponGroups', entry.groupUid);
    expect(project.battle.characters[0].weapons[0].groupUid).toBe('');
    expect(project.battle.characters[0].weapons[0].slotUid).toBe('sl1');

    project = removeWeaponOption(project, 'slots', 'sl1');
    expect(project.battle.characters[0].weapons[0].slotUid).toBe('');
  });

  it('新建分组时导出名称带 TXT_WeaponTeam_ 前缀，攻击模式仍默认等于显示名称', () => {
    let project = addWeaponOption(makeWeaponProject(), 'weaponGroups');
    const group = project.battle.weaponGroups.at(-1)!;
    expect([group.name, group.exportName]).toEqual(['新分组', 'TXT_WeaponTeam_新分组']);

    project = addWeaponOption(project, 'attackModes');
    const mode = project.battle.attackModes.at(-1)!;
    expect([mode.name, mode.exportName]).toEqual(['新攻击模式', '新攻击模式']);
  });

  it('本地化页改名：中文写回显示名称，英文日文写在同一行上', () => {
    let project = makeWeaponProject();
    const fire = project.battle.weaponGroups.find((row) => row.name === '火力')!;

    project = updateWeaponOptionNameText(project, fire.uid, 'en', 'Firepower');
    project = updateWeaponOptionNameText(project, fire.uid, 'ja', '火力');
    project = updateWeaponOptionNameText(project, fire.uid, 'zh', '主火力');
    const row = project.battle.weaponGroups.find((item) => item.uid === fire.uid)!;
    expect([row.name, row.nameEn, row.nameJa]).toEqual(['主火力', 'Firepower', '火力']);
  });
});

