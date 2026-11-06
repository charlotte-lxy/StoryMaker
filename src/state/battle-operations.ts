/**
 * 战斗模块（GAS）的默认数据与增删改。
 *
 * 和剧情那边一样，所有修改都走 mutate()：先克隆再改，不就地动 React 状态。
 */

import { newUid } from '../core/ids';
import type {
  GasCharacter,
  GasEffect,
  GasModifier,
  GasOptionRow,
  GasPair,
  GasSkill,
  GasWeapon,
  LangKey,
  WeaponLoadout,
  Project,
} from '../core/types';
import { WEAPON_GROUP_EXPORT_PREFIX } from '../core/battle';
import { mutate } from './operations';

/** 战斗模块里的子页面 */
export type BattlePage =
  | 'tags'
  | 'attributes'
  | 'effects'
  | 'skills'
  | 'events'
  | 'characters'
  | 'weapons';

/** 有列表的六张表（GameplayTags 是收集出来的，不单独存） */
export type BattleRowKey = 'attributes' | 'effects' | 'skills' | 'events' | 'characters' | 'weapons';

/** 新建修改器：默认「基础 + 第一个属性 + 加号」，值留空等策划填 */
export function createModifier(attributeUid = ''): GasModifier {
  return { uid: newUid(), duration: '基础', attributeUid, operator: '+', value: '' };
}

export function createPair(key = ''): GasPair {
  return { uid: newUid(), key, value: '' };
}

/** 六张表在界面上按这个顺序排 */
const NEW_ROW_LABEL: Record<Exclude<BattleRowKey, 'characters' | 'weapons'>, string> = {
  attributes: '新属性',
  effects: '新效果',
  skills: '新技能',
  events: '新事件',
};

/* ---------- 角色预设带的武器（每把一条，四个 uid） ---------- */
/**
 * 角色预设身上新增一把武器。
 *
 * 默认填第一把武器 / 第一把插槽 / 第一个攻击模式，分组默认「火力」——
 * 所以加完只有武器需要挑（如果表里还没建，留空等策划去建）。
 */
export function addCharacterWeapon(project: Project, characterUid: string): Project {
  return mutate(project, (draft) => {
    const character = draft.battle.characters.find((row) => row.uid === characterUid);
    if (character === undefined) return;
    const battle = draft.battle;
    const group =
      battle.weaponGroups.find((row) => row.name.trim() === '火力') ?? battle.weaponGroups[0];
    character.weapons.push({
      uid: newUid(),
      weaponUid: battle.weapons[0]?.uid ?? '',
      groupUid: group?.uid ?? '',
      slotUid: battle.slots[0]?.uid ?? '',
      attackModeUid: battle.attackModes[0]?.uid ?? '',
    });
  });
}

export function removeCharacterWeapon(
  project: Project,
  characterUid: string,
  weaponEntryUid: string,
): Project {
  return mutate(project, (draft) => {
    const character = draft.battle.characters.find((row) => row.uid === characterUid);
    if (character === undefined) return;
    character.weapons = character.weapons.filter((row) => row.uid !== weaponEntryUid);
  });
}

/** 改角色预设身上的一把武器（条目 uid 全局唯一，按它找就行） */
export function updateCharacterWeapon(
  project: Project,
  weaponEntryUid: string,
  patch: Partial<WeaponLoadout>,
): Project {
  return mutate(project, (draft) => {
    for (const character of draft.battle.characters) {
      const row = character.weapons.find((item) => item.uid === weaponEntryUid);
      if (row !== undefined) {
        Object.assign(row, patch);
        return;
      }
    }
  });
}


const ID_PREFIX: Record<'characters' | 'weapons', string> = {
  characters: 'CHA_',
  weapons: 'WEA_',
};

export function addBattleRow(project: Project, key: BattleRowKey): Project {
  return mutate(project, (draft) => {
    if (key === 'characters') {
      const taken = new Set(draft.battle.characters.map((row) => row.id));
      let n = draft.battle.characters.length + 1;
      while (taken.has(`${ID_PREFIX.characters}${n}`)) n += 1;
      const row: GasCharacter = {
        uid: newUid(),
        id: `${ID_PREFIX.characters}${n}`,
        name: '',
        attributes: [],
        skillUids: [],
        weapons: [],
      };
      draft.battle.characters.push(row);
      return;
    }

    if (key === 'weapons') {
      const taken = new Set(draft.battle.weapons.map((row) => row.id));
      let n = draft.battle.weapons.length + 1;
      while (taken.has(`${ID_PREFIX.weapons}${n}`)) n += 1;
      const row: GasWeapon = {
        uid: newUid(),
        id: `${ID_PREFIX.weapons}${n}`,
        name: '',
        description: '',
        magazine: '-1',
        attackSpeed: '1',
        energyCost: '0',
        attackModeUids: [],
        slotUids: [],
      };
      draft.battle.weapons.push(row);
      return;
    }

    const label = NEW_ROW_LABEL[key];
    const taken = new Set(draft.battle[key].map((row) => row.name));
    let n = draft.battle[key].length + 1;
    while (taken.has(`${label}${n}`)) n += 1;
    const name = `${label}${n}`;

    if (key === 'attributes') {
      draft.battle.attributes.push({ uid: newUid(), name, note: '', tagNote: '' });
      return;
    }
    if (key === 'events') {
      draft.battle.events.push({ uid: newUid(), name, note: '', tagNote: '' });
      return;
    }
    if (key === 'skills') {
      draft.battle.skills.push({
        uid: newUid(),
        name,
        className: '',
        lockSkillUids: [],
        listenEventUids: [],
        parameters: [],
        tagNote: '',
      });
      return;
    }
    const effect: GasEffect = {
      uid: newUid(),
      name,
      note: '',
      className: 'BP_GameEffect_Base',
      // 总时长 -1 = 无限、周期 0 = 不周期触发，和样例里最常用的一组一致
      duration: '-1',
      period: '0',
      periodImmediate: false,
      reduceStacks: '0',
      maxStacks: '1',
      refreshDuration: false,
      refreshPeriod: false,
      modifiers: [],
      tagNote: '',
    };
    draft.battle.effects.push(effect);
  });
}

export function removeBattleRow(project: Project, key: BattleRowKey, uid: string): Project {
  return mutate(project, (draft) => {
    const list = draft.battle[key];
    const at = list.findIndex((row) => row.uid === uid);
    if (at >= 0) list.splice(at, 1);
  });
}

/** 改一行的普通字段；各表字段不同，补丁按字段名宽松地合进去 */
export function updateBattleRow(
  project: Project,
  key: BattleRowKey,
  uid: string,
  patch: Partial<Record<string, unknown>>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.battle[key].find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/**
 * 拖拽排序：把 from 位置的行移到 to 位置。
 *
 * 六张主表都是「数组顺序 = 导出顺序」，所以这里只挪数组，没有别的要跟着改的东西；
 * GameplayTags 管理器是收集出来的，不在这里排。
 */
export function reorderBattleRow(
  project: Project,
  key: BattleRowKey,
  from: number,
  to: number,
): Project {
  return mutate(project, (draft) => {
    // 六张表的行类型各不相同，排顺序只关心「是个带 uid 的行」，统一放到这一个视图上
    const list: { uid: string }[] = draft.battle[key];
    if (from === to) return;
    if (from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
  });
}

/** 类名路径前缀：技能用 GA 的，效果用 GE 的 */
export function updateClassPrefix(
  project: Project,
  key: 'skillClassPrefix' | 'effectClassPrefix' | 'weaponClassPrefix',
  value: string,
): Project {
  return mutate(project, (draft) => {
    draft.battle[key] = value;
  });
}

/* ---------- 修改器列表（只有效果表有；武器表改成「能量消耗」之后不再用修改器） ---------- */

function modifierOwners(draft: Project): GasEffect[] {
  return draft.battle.effects;
}

export function addModifier(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft).find((row) => row.uid === uid);
    if (owner === undefined) return;
    // 默认选属性表第一条：修改器里存的是那一行的 uid
    owner.modifiers.push(createModifier(draft.battle.attributes[0]?.uid ?? ''));
  });
}

export function removeModifier(
  project: Project,
  uid: string,
  modifierUid: string,
): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft).find((row) => row.uid === uid);
    if (owner === undefined) return;
    owner.modifiers = owner.modifiers.filter((row) => row.uid !== modifierUid);
  });
}

export function updateModifier(
  project: Project,
  uid: string,
  modifierUid: string,
  patch: Partial<GasModifier>,
): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft).find((row) => row.uid === uid);
    const row = owner?.modifiers.find((item) => item.uid === modifierUid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/* ---------- 键值对列表（技能的参数赋值 / 角色预设的属性数值） ---------- */

/** 键值对挂在哪一行的哪个字段上：技能叫参数赋值，角色预设叫属性列表，结构一样 */
function pairListOf(row: GasSkill | GasCharacter): GasPair[] {
  return 'parameters' in row ? row.parameters : row.attributes;
}

function setPairList(row: GasSkill | GasCharacter, list: GasPair[]): void {
  if ('parameters' in row) row.parameters = list;
  else row.attributes = list;
}

function pairOwners(draft: Project, key: 'skills' | 'characters'): (GasSkill | GasCharacter)[] {
  return key === 'skills' ? draft.battle.skills : draft.battle.characters;
}

export function addPair(project: Project, key: 'skills' | 'characters', uid: string): Project {
  return mutate(project, (draft) => {
    const owner = pairOwners(draft, key).find((row) => row.uid === uid);
    if (owner === undefined) return;
    pairListOf(owner).push(createPair());
  });
}

export function removePair(
  project: Project,
  key: 'skills' | 'characters',
  uid: string,
  pairUid: string,
): Project {
  return mutate(project, (draft) => {
    const owner = pairOwners(draft, key).find((row) => row.uid === uid);
    if (owner === undefined) return;
    setPairList(owner, pairListOf(owner).filter((row) => row.uid !== pairUid));
  });
}

export function updatePair(
  project: Project,
  key: 'skills' | 'characters',
  uid: string,
  pairUid: string,
  patch: Partial<GasPair>,
): Project {
  return mutate(project, (draft) => {
    const owner = pairOwners(draft, key).find((row) => row.uid === uid);
    if (owner === undefined) return;
    const row = pairListOf(owner).find((item) => item.uid === pairUid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/* ---------- 攻击模式 / 插槽配置（武器页顶部的两张小表） ---------- */

/** 武器页顶部的两张配置表：显示名称 + 导出名称 */
export type WeaponOptionKey = 'weaponGroups' | 'attackModes' | 'slots';

const OPTION_LABEL: Record<WeaponOptionKey, string> = {
  weaponGroups: '新分组',
  attackModes: '新攻击模式',
  slots: '新插槽',
};

export function addWeaponOption(project: Project, key: WeaponOptionKey): Project {
  return mutate(project, (draft) => {
    const list = draft.battle[key];
    const taken = new Set(list.map((row) => row.name.trim()));
    let n = 1;
    while (taken.has(`${OPTION_LABEL[key]}${n === 1 ? '' : n}`)) n += 1;
    const name = `${OPTION_LABEL[key]}${n === 1 ? '' : n}`;
    // 分组的导出名按现有约定带 TXT_WeaponTeam_ 前缀；其余默认跟显示名称一样
    const exportName =
      key === 'weaponGroups' ? `${WEAPON_GROUP_EXPORT_PREFIX}${name}` : name;
    list.push({ uid: newUid(), name, exportName, nameEn: '', nameJa: '' });
  });
}

export function updateWeaponOption(
  project: Project,
  key: WeaponOptionKey,
  uid: string,
  patch: Partial<GasOptionRow>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.battle[key].find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/**
 * 删一条配置。
 *
 * 除了从表里拿掉，还要把引用一起清掉：武器表的多选列表里摘掉它，
 * 角色身上那把武器如果正好选的是它，就把那一格清空（免得留下悬空引用）。
 */
export function removeWeaponOption(project: Project, key: WeaponOptionKey, uid: string): Project {
  return mutate(project, (draft) => {
    draft.battle[key] = draft.battle[key].filter((row) => row.uid !== uid);

    const field =
      key === 'attackModes' ? 'attackModeUids' : key === 'slots' ? 'slotUids' : null;
    if (field !== null) {
      for (const weapon of draft.battle.weapons) {
        weapon[field] = weapon[field].filter((item) => item !== uid);
      }
    }

    const characterField =
      key === 'weaponGroups' ? 'groupUid' : key === 'slots' ? 'slotUid' : 'attackModeUid';
    for (const character of draft.battle.characters) {
      for (const row of character.weapons) {
        if (row[characterField] === uid) row[characterField] = '';
      }
    }
  });
}

/**
 * 本地化页改一条武器配置的名字：中文写回「显示名称」，英文日文写在同一行上。
 *
 * 三张配置表（分组 / 攻击模式 / 插槽）共用一种行结构，按 uid 找一遍就行。
 */
export function updateWeaponOptionNameText(
  project: Project,
  uid: string,
  lang: LangKey,
  value: string,
): Project {
  return mutate(project, (draft) => {
    for (const key of ['weaponGroups', 'attackModes', 'slots'] as const) {
      const row = draft.battle[key].find((item) => item.uid === uid);
      if (row === undefined) continue;
      if (lang === 'zh') row.name = value;
      else if (lang === 'en') row.nameEn = value;
      else row.nameJa = value;
      return;
    }
  });
}

/* ---------- 多选列表（锁定 GA / 监听事件 / 技能列表） ---------- */

export function updateBattleList(
  project: Project,
  key: 'skills' | 'characters' | 'weapons',
  uid: string,
  field: 'lockSkillUids' | 'listenEventUids' | 'skillUids' | 'attackModeUids' | 'slotUids',
  values: string[],
): Project {
  return mutate(project, (draft) => {
    const row = draft.battle[key].find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, { [field]: values });
  });
}
