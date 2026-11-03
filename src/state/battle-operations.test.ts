import { describe, expect, it } from 'vitest';

import {
  addBattleRow,
  addWeaponOption,
  removeWeaponOption,
  updateBattleList,
  updateWeaponOption,
} from './battle-operations';
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
