import { describe, expect, it } from 'vitest';

import {
  addBattleRow,
  addCharacterWeapon,
  addWeaponBinding,
  addWeaponOption,
  removeCharacterWeapon,
  removeWeaponBinding,
  removeWeaponOption,
  updateBattleList,
  setCharacterWeapon,
  updateWeaponBinding,
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
  /** 两把武器（每把支持一个插槽 + 一个攻击模式），角色身上还什么都没带 */
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
        attackModeUids: ['am1'],
        slotUids: ['sl1'],
      },
      {
        uid: 'w2',
        id: 'WEA_测试-刀',
        name: '测试-刀',
        description: '',
        magazine: '-1',
        attackSpeed: '1',
        energyCost: '0',
        attackModeUids: ['am2'],
        slotUids: ['sl2'],
      },
    ];
    project.battle.slots = [
      { uid: 'sl1', name: '右手', exportName: 'TXT_WeaponTeamSlot_右手', nameEn: '', nameJa: '' },
      { uid: 'sl2', name: '后背', exportName: 'TXT_WeaponTeamSlot_后背', nameEn: '', nameJa: '' },
    ];
    project.battle.attackModes = [
      { uid: 'am1', name: '手动攻击', exportName: 'TXT_AttackMode_手动攻击', nameEn: '', nameJa: '' },
      { uid: 'am2', name: '自动攻击', exportName: 'TXT_AttackMode_自动攻击', nameEn: '', nameJa: '' },
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


  it('新增武器：先只有武器下拉，选了武器才自动挂上第一条绑定关系', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entry = project.battle.characters[0].weapons[0];
    expect(entry.weaponUid).toBe('');
    expect(entry.bindings).toEqual([]);

    project = setCharacterWeapon(project, entry.uid, 'w1');
    const bound = project.battle.characters[0].weapons[0];
    expect(bound.bindings).toHaveLength(1);
    expect(bound.bindings[0].slotUid).toBe('sl1');
    expect(bound.bindings[0].attackModeUid).toBe('am1');
    // 分组默认第一个可用的（火力）
    const fire = project.battle.weaponGroups[0];
    expect(bound.bindings[0].groupUid).toBe(fire.uid);
  });

  it('绑定关系能加、能改、能删；同一把武器的分组不重复', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');

    // 再加一条：自动挑第二个分组
    project = addWeaponBinding(project, entryUid);
    let bindings = project.battle.characters[0].weapons[0].bindings;
    expect(bindings).toHaveLength(2);
    expect(new Set(bindings.map((row) => row.groupUid)).size).toBe(2);

    // 改一条的插槽 / 攻击模式
    const target = bindings[1];
    project = updateWeaponBinding(project, target.uid, {
      slotUid: 'sl1',
      attackModeUid: 'am1',
    });
    bindings = project.battle.characters[0].weapons[0].bindings;
    expect(bindings[1]).toMatchObject({ slotUid: 'sl1', attackModeUid: 'am1' });

    // 删一条
    project = removeWeaponBinding(project, entryUid, bindings[0].uid);
    bindings = project.battle.characters[0].weapons[0].bindings;
    expect(bindings).toHaveLength(1);
    expect(bindings[0].uid).toBe(target.uid);
  });

  it('分组全用完后不再加绑定；换武器把不支持的插槽 / 攻击模式换成新武器支持的', () => {
    let project = makeWeaponProject();
    // 只有两个分组，武器 w1 支持 sl1 / am1
    project.battle.weaponGroups = project.battle.weaponGroups.slice(0, 2);
    const entryUid = (project = addCharacterWeapon(project, 'ch1')).battle.characters[0].weapons[0]
      .uid;
    project = setCharacterWeapon(project, entryUid, 'w1');

    project = addWeaponBinding(project, entryUid);
    // 两个分组都用完了：再加不进去
    const before = project.battle.characters[0].weapons[0].bindings.length;
    project = addWeaponBinding(project, entryUid);
    expect(project.battle.characters[0].weapons[0].bindings).toHaveLength(before);

    // 换成刀（只支持 sl2 / am2）：绑定关系里的插槽 / 攻击模式跟着换
    project = setCharacterWeapon(project, entryUid, 'w2');
    const bindings = project.battle.characters[0].weapons[0].bindings;
    expect(bindings.every((row) => row.slotUid === 'sl2' && row.attackModeUid === 'am2')).toBe(true);
  });

  it('删掉一把武器条目：只动那一条', () => {
    let project = makeWeaponProject();
    project = addCharacterWeapon(project, 'ch1');
    project = addCharacterWeapon(project, 'ch1');
    const [first, second] = project.battle.characters[0].weapons;
    project = setCharacterWeapon(project, second.uid, 'w2');

    project = removeCharacterWeapon(project, 'ch1', first.uid);
    const left = project.battle.characters[0].weapons;
    expect(left.map((row) => row.weaponUid)).toEqual(['w2']);
  });

  it('删掉分组 / 插槽：绑定关系里对应的那一格清空', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');
    const binding = project.battle.characters[0].weapons[0].bindings[0];

    project = removeWeaponOption(project, 'weaponGroups', binding.groupUid);
    expect(project.battle.characters[0].weapons[0].bindings[0].groupUid).toBe('');

    project = removeWeaponOption(project, 'slots', binding.slotUid);
    expect(project.battle.characters[0].weapons[0].bindings[0].slotUid).toBe('');
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

