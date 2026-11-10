import { describe, expect, it } from 'vitest';

import {
  addBattleRow,
  addCharacterWeapon,
  addWeaponGroupBinding,
  addWeaponOption,
  removeCharacterWeapon,
  removeWeaponGroupBinding,
  removeWeaponOption,
  updateBattleList,
  setCharacterWeapon,
  mountWeaponSlot,
  setWeaponGroupBindingGroup,
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
        weaponBindings: [],
        weapons: [],
      },
    ];
    return project;
  }



  it('武器列：加一条只有武器下拉，选了武器只改它自己（不再自动挂绑定关系）', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entry = project.battle.characters[0].weapons[0];
    expect(entry.weaponUid).toBe('');

    project = setCharacterWeapon(project, entry.uid, 'w1');
    expect(project.battle.characters[0].weapons[0].weaponUid).toBe('w1');
    // 绑定关系是单独一列，不跟着武器走
    expect(project.battle.characters[0].weaponBindings).toEqual([]);
  });

  it('绑定关系：加分组默认挑没用的分组，行里装着插槽 → 武器', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');

    project = addWeaponGroupBinding(project, 'ch1');
    const [first] = project.battle.characters[0].weaponBindings;
    expect(first.groupUid).toBe(project.battle.weaponGroups[0].uid);
    expect(first.mounts).toEqual([]);

    // 第二个分组：自动挑下一个没用的
    project = addWeaponGroupBinding(project, 'ch1');
    const bindings = project.battle.characters[0].weaponBindings;
    expect(bindings).toHaveLength(2);
    expect(bindings[1].groupUid).toBe(project.battle.weaponGroups[1].uid);

    // 在「火力」的右手插槽里装上第 1 条武器：默认带上它支持的第一个攻击模式
    project = mountWeaponSlot(project, first.uid, 'sl1', { weaponEntryUid: entryUid });
    const mount = project.battle.characters[0].weaponBindings[0].mounts[0];
    expect(mount).toMatchObject({ slotUid: 'sl1', weaponEntryUid: entryUid, attackModeUid: 'am1' });

    // 改攻击模式
    project = mountWeaponSlot(project, first.uid, 'sl1', { attackModeUid: 'am1' });
    expect(project.battle.characters[0].weaponBindings[0].mounts[0].attackModeUid).toBe('am1');

    // 清空这一格
    project = mountWeaponSlot(project, first.uid, 'sl1', { weaponEntryUid: '' });
    expect(project.battle.characters[0].weaponBindings[0].mounts).toEqual([]);
  });

  it('换分组 / 删分组行；删武器时绑定关系里指向它的插槽一起清掉', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');
    project = addWeaponGroupBinding(project, 'ch1');
    const bindingUid = project.battle.characters[0].weaponBindings[0].uid;
    project = mountWeaponSlot(project, bindingUid, 'sl1', { weaponEntryUid: entryUid });

    // 换成光束
    const beam = project.battle.weaponGroups[1];
    project = setWeaponGroupBindingGroup(project, bindingUid, beam.uid);
    expect(project.battle.characters[0].weaponBindings[0].groupUid).toBe(beam.uid);

    // 删掉武器：插槽里的安装记录也清掉
    project = removeCharacterWeapon(project, 'ch1', entryUid);
    expect(project.battle.characters[0].weapons).toEqual([]);
    expect(project.battle.characters[0].weaponBindings[0].mounts).toEqual([]);

    // 删分组行
    project = removeWeaponGroupBinding(project, bindingUid);
    expect(project.battle.characters[0].weaponBindings).toEqual([]);
  });

  it('换武器时：原来装了这个插槽但新武器不支持，就清掉那一格', () => {
    let project = makeWeaponProject();
    project = addCharacterWeapon(project, 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');
    project = addWeaponGroupBinding(project, 'ch1');
    const bindingUid = project.battle.characters[0].weaponBindings[0].uid;
    project = mountWeaponSlot(project, bindingUid, 'sl1', { weaponEntryUid: entryUid });

    // 换成刀（只支持 sl2）：右手那一格装不上了，清空
    project = setCharacterWeapon(project, entryUid, 'w2');
    expect(project.battle.characters[0].weaponBindings[0].mounts).toEqual([]);
  });

  it('删掉分组 / 插槽 / 攻击模式：绑定关系里对应的内容一起处理', () => {
    let project = addCharacterWeapon(makeWeaponProject(), 'ch1');
    const entryUid = project.battle.characters[0].weapons[0].uid;
    project = setCharacterWeapon(project, entryUid, 'w1');
    project = addWeaponGroupBinding(project, 'ch1');
    const binding = project.battle.characters[0].weaponBindings[0];
    project = mountWeaponSlot(project, binding.uid, 'sl1', { weaponEntryUid: entryUid });

    // 删插槽：那一格没了
    project = removeWeaponOption(project, 'slots', 'sl1');
    expect(project.battle.characters[0].weaponBindings[0].mounts).toEqual([]);

    // 重新装上，再删攻击模式：攻击模式清空，安装还在
    project = mountWeaponSlot(project, binding.uid, 'sl1', { weaponEntryUid: entryUid });
    project = removeWeaponOption(project, 'attackModes', 'am1');
    const mount = project.battle.characters[0].weaponBindings[0].mounts[0];
    expect(mount.weaponEntryUid).toBe(entryUid);
    expect(mount.attackModeUid).toBe('');

    // 删分组：整个分组行去掉
    project = removeWeaponOption(project, 'weaponGroups', binding.groupUid);
    expect(project.battle.characters[0].weaponBindings).toEqual([]);
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

