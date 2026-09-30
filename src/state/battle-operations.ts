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
  GasPair,
  GasSkill,
  GasWeapon,
  Project,
} from '../core/types';
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
export function createModifier(attribute = ''): GasModifier {
  return { uid: newUid(), duration: '基础', attribute, operator: '+', value: '' };
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
        skills: [],
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
        modifiers: [],
        skills: [],
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
        lockSkills: [],
        listenEvents: [],
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
  key: 'skillClassPrefix' | 'effectClassPrefix',
  value: string,
): Project {
  return mutate(project, (draft) => {
    draft.battle[key] = value;
  });
}

/* ---------- 修改器列表（效果 / 武器） ---------- */

function modifierOwners(draft: Project, key: 'effects' | 'weapons'): (GasEffect | GasWeapon)[] {
  return key === 'effects' ? draft.battle.effects : draft.battle.weapons;
}

export function addModifier(project: Project, key: 'effects' | 'weapons', uid: string): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft, key).find((row) => row.uid === uid);
    if (owner === undefined) return;
    owner.modifiers.push(createModifier(draft.battle.attributes[0]?.name ?? ''));
  });
}

export function removeModifier(
  project: Project,
  key: 'effects' | 'weapons',
  uid: string,
  modifierUid: string,
): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft, key).find((row) => row.uid === uid);
    if (owner === undefined) return;
    owner.modifiers = owner.modifiers.filter((row) => row.uid !== modifierUid);
  });
}

export function updateModifier(
  project: Project,
  key: 'effects' | 'weapons',
  uid: string,
  modifierUid: string,
  patch: Partial<GasModifier>,
): Project {
  return mutate(project, (draft) => {
    const owner = modifierOwners(draft, key).find((row) => row.uid === uid);
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

/* ---------- 多选列表（锁定 GA / 监听事件 / 技能列表） ---------- */

export function updateBattleList(
  project: Project,
  key: 'skills' | 'characters' | 'weapons',
  uid: string,
  field: 'lockSkills' | 'listenEvents' | 'skills',
  values: string[],
): Project {
  return mutate(project, (draft) => {
    const row = draft.battle[key].find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, { [field]: values });
  });
}
