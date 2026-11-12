/**
 * 战斗模块（GAS）的导出：7 张子表，都是「策划填的中间列 + 公式列」里的最终结果。
 *
 * 和剧情那边一个思路：中间输入列（带「（多选）」「（换行分割）」后缀的、类名、
 * 以及 Tag / DevComment）不进导出表，导出的只有 Unreal 要的最终列（类名补成的
 * GA类 / GE类 全路径要导出）。
 *
 * 列顺序、布尔写法（True / False）、空值写法都对着策划给的样例 CSV 来。
 */

import { formatArrayLiteral } from './array-literal';
import {
  attributeTag,
  classPath,
  collectGameplayTags,
  effectTag,
  eventTag,
  formatPairLiteral,
  modifierTexts,
  skillTag,
  tagStructLiteral,
  weaponClassName,
} from './battle';
import { weaponInfoKeyOf, weaponNameKeyOf } from './ids';
import { attributeNameOf, eventNameOf, skillNameOf } from './refs';
import { weaponIconId } from './weapon-icons';
import type { BattleData, GasModifier, GasOptionRow, GasPair, Project, WeaponEntry, WeaponGroupBinding } from './types';

export const GAMEPLAY_TAGS_SHEET = 'GASGameplayTags';
export const ATTRIBUTE_SHEET = 'GAS属性';
export const EFFECT_SHEET = 'GAS效果';
export const SKILL_SHEET = 'GAS技能';
export const EVENT_SHEET = 'GAS事件';
export const CHARACTER_SHEET = 'GAS角色';
export const WEAPON_SHEET = 'GAS武器';

export const GAMEPLAY_TAGS_HEADER: readonly string[] = ['', 'Tag', 'DevComment'];
export const ATTRIBUTE_HEADER: readonly string[] = ['', '属性名', '属性标签'];
export const EFFECT_HEADER: readonly string[] = [
  '',
  '效果名',
  '备注',
  '总时长',
  '周期-时长',
  '周期-首次立即触发',
  '触发-减少层数',
  '堆叠-最大层数',
  '堆叠-获得层数时刷新总时长',
  '堆叠-获得层数时刷新周期时长',
  '修改器列表',
  'GE类',
];
export const SKILL_HEADER: readonly string[] = [
  '',
  '技能名',
  '锁定GA列表',
  '监听事件列表',
  '参数赋值列表',
  'GA类',
];
export const EVENT_HEADER: readonly string[] = ['', '事件名', '事件标签'];
export const CHARACTER_HEADER: readonly string[] = [
  '',
  '角色名',
  '属性列表',
  '技能列表',
  '武器',
  '武器绑定关系',
];
export const WEAPON_HEADER: readonly string[] = [
  '',
  '武器名',
  '武器描述',
  '弹匣容量',
  '攻击速度',
  '能量消耗',
  '支持攻击模式列表',
  '支持插槽列表',
  '武器图标',
  '武器类',
];

export interface BattleSheetRows {
  gameplayTags: string[][];
  attributes: string[][];
  effects: string[][];
  skills: string[][];
  events: string[][];
  characters: string[][];
  weapons: string[][];
}

/** 样例里的布尔写法是 True / False */
const boolText = (value: boolean): string => (value ? 'True' : 'False');

/** 角色 / 武器的技能列表存的是技能表的 uid，导出成技能 Tag */
const skillTags = (battle: BattleData, uids: readonly string[]): string[] =>
  uids.map((uid) => skillTag(skillNameOf(battle, uid))).filter((tag) => tag !== '');

/**
 * 武器用的攻击模式 / 插槽：存的是配置表那一行的 uid，导出写它的**导出名称**。
 *
 * 没填导出名的跳过（由校验条提醒），不往表里写半截东西。
 */
const optionNames = (rows: readonly GasOptionRow[], uids: readonly string[]): string[] =>
  uids
    .map((uid) => rows.find((row) => row.uid === uid)?.exportName.trim() ?? '')
    .filter((name) => name !== '');

/**
 * 攻击模式列表按样例写成 `(A,B,C)`：名字不加引号（样例里是 TXT_AttackMode_* 这种 key）。
 *
 * 名字里带逗号 / 括号 / 引号会把这个格式写坏，所以顺手换成全角，
 * 免得 Unreal 导入时解析出半截。
 */
const NAME_LIST_ESCAPE: Record<string, string> = {
  ',': '，',
  '(': '（',
  ')': '）',
  '"': '＂',
};

function formatNameList(names: readonly string[]): string {
  const safe = names.map((name) =>
    [...name].map((char) => NAME_LIST_ESCAPE[char] ?? char).join(''),
  );
  return safe.length === 0 ? '' : `(${safe.join(',')})`;
}

/** 监听事件列表同理，导出成事件 Tag */
const eventTags = (battle: BattleData, uids: readonly string[]): string[] =>
  uids.map((uid) => eventTag(eventNameOf(battle, uid))).filter((tag) => tag !== '');

/** 修改器列表：属性那一格是属性表的 uid，先取回属性名再合成文本 */
const modifierTextsOf = (battle: BattleData, modifiers: readonly GasModifier[]): string[] =>
  modifierTexts(modifiers, (uid) => attributeNameOf(battle, uid));

/**
 * 武器类：前缀 + `BP_Weapon_<武器ID去WEA_>`。
 *
 * 拼不出来（ID 空、或者前缀被清空）时写 `None`——样例里没有武器类的行就是 None。
 */
const weaponClassOf = (battle: BattleData, weaponId: string): string => {
  const prefix = battle.weaponClassPrefix.trim();
  const name = weaponClassName(weaponId);
  return prefix === '' || name === '' ? 'None' : classPath(prefix, name);
};

/** 角色属性列表的 key 是属性表的 uid，导出成属性 Tag */
const attributePairs = (battle: BattleData, pairs: readonly GasPair[]): GasPair[] =>
  pairs
    .filter((pair) => pair.key.trim() !== '')
    .map((pair) => ({ ...pair, key: attributeTag(attributeNameOf(battle, pair.key)) }));

/**
 * 角色预设「武器」列：每把武器一个武器 ID（按武器列的顺序，允许重复）。
 *
 * 还没选武器的那一条跳过（它没有 ID 可写），它也不占绑定关系里的下标。
 */
function weaponIdTexts(battle: BattleData, entries: readonly WeaponEntry[]): string[] {
  const weaponIds = new Map(battle.weapons.map((row) => [row.uid, row.id.trim()]));
  const out: string[] = [];
  for (const entry of entries) {
    const id = weaponIds.get(entry.weaponUid) ?? '';
    if (id !== '') out.push(id);
  }
  return out;
}

/** 导出里「武器列」的下标：从 1 开始数，和界面上的编号一致 */
function weaponIndexesOf(entries: readonly WeaponEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  let index = 0;
  for (const entry of entries) {
    if (entry.weaponUid === '') continue;
    index += 1;
    map.set(entry.uid, index);
  }
  return map;
}

/**
 * 角色预设「武器绑定关系」列：每个装好的插槽一个字符串
 * `分组|插槽|武器下标|攻击模式`。
 *
 * 分组 / 插槽 / 攻击模式都写导出名称；武器下标对应该角色「武器」列里的顺序（从 1 开始）。
 * 分组或插槽没填、下标算不出来（那把武器已经不在武器列里了）的跳过。
 */
function weaponBindingTexts(
  battle: BattleData,
  entries: readonly WeaponEntry[],
  groups: readonly WeaponGroupBinding[],
): string[] {
  const indexes = weaponIndexesOf(entries);
  const exportNameOf = (rows: readonly GasOptionRow[], uid: string): string =>
    rows.find((row) => row.uid === uid)?.exportName.trim() ?? '';

  const out: string[] = [];
  for (const group of groups) {
    const groupName = exportNameOf(battle.weaponGroups, group.groupUid);
    if (groupName === '') continue;

    for (const mount of group.mounts) {
      const slotName = exportNameOf(battle.slots, mount.slotUid);
      const index = indexes.get(mount.weaponEntryUid) ?? 0;
      if (slotName === '' || index === 0) continue;
      out.push(
        [groupName, slotName, String(index), exportNameOf(battle.attackModes, mount.attackModeUid)]
          .join('|'),
      );
    }
  }
  return out;
}

/** 只清掉整行都空的情况，值本身保持原样 */
const filledPairs = (pairs: readonly GasPair[]): GasPair[] =>
  pairs.filter((pair) => pair.key.trim() !== '' || pair.value.trim() !== '');

export function buildBattleRows(project: Project): BattleSheetRows {
  const battle = project.battle;

  return {
    gameplayTags: [
      [...GAMEPLAY_TAGS_HEADER],
      // 第一列（行名）与第二列都是合成后的 Tag，第三列是备注
      ...collectGameplayTags(battle).map((entry) => [entry.tag, entry.tag, entry.tagNote]),
    ],
    attributes: [
      [...ATTRIBUTE_HEADER],
      ...battle.attributes
        .filter((row) => row.name.trim() !== '')
        .map((row) => [attributeTag(row.name), row.name.trim(), tagStructLiteral(attributeTag(row.name))]),
    ],
    effects: [
      [...EFFECT_HEADER],
      ...battle.effects
        .filter((row) => row.name.trim() !== '')
        .map((row) => [
          effectTag(row.name),
          row.name.trim(),
          row.note,
          row.duration,
          row.period,
          boolText(row.periodImmediate),
          row.reduceStacks,
          row.maxStacks,
          boolText(row.refreshDuration),
          boolText(row.refreshPeriod),
          formatArrayLiteral(modifierTextsOf(battle, row.modifiers)),
          classPath(battle.effectClassPrefix, row.className),
        ]),
    ],
    skills: [
      [...SKILL_HEADER],
      ...battle.skills
        .filter((row) => row.name.trim() !== '')
        .map((row) => [
          skillTag(row.name),
          row.name.trim(),
          formatArrayLiteral(skillTags(battle, row.lockSkillUids)),
          formatArrayLiteral(eventTags(battle, row.listenEventUids)),
          formatPairLiteral(filledPairs(row.parameters)),
          classPath(battle.skillClassPrefix, row.className),
        ]),
    ],
    events: [
      [...EVENT_HEADER],
      ...battle.events
        .filter((row) => row.name.trim() !== '')
        .map((row) => [eventTag(row.name), row.name.trim(), tagStructLiteral(eventTag(row.name))]),
    ],
    characters: [
      [...CHARACTER_HEADER],
      ...battle.characters
        .filter((row) => row.id.trim() !== '' || row.name.trim() !== '')
        .map((row) => [
          row.id.trim(),
          row.name,
          formatPairLiteral(attributePairs(battle, filledPairs(row.attributes))),
          formatArrayLiteral(skillTags(battle, row.skillUids)),
          // 武器：按顺序每把武器一个武器 ID；绑定关系另一列
          formatArrayLiteral(weaponIdTexts(battle, row.weapons)),
          formatArrayLiteral(weaponBindingTexts(battle, row.weapons, row.weaponBindings)),
        ]),
    ],
    weapons: [
      [...WEAPON_HEADER],
      ...battle.weapons
        .filter((row) => row.id.trim() !== '' || row.name.trim() !== '')
        .map((row) => [
          row.id.trim(),
          // 武器名 / 武器描述导出的是本地化 key（中文在「武器配置本地化」页里看 / 改）；
          // 没填武器 ID 的行拼不出 key，原样写文字（校验条会提醒缺 ID）
          row.id.trim() === '' ? row.name : weaponNameKeyOf(row.id.trim()),
          row.id.trim() === '' ? row.description : weaponInfoKeyOf(row.id.trim()),
          row.magazine,
          row.attackSpeed,
          row.energyCost,
          // 攻击模式按样例不加引号；插槽是普通字符串数组（带引号）
          formatNameList(optionNames(battle.attackModes, row.attackModeUids)),
          formatArrayLiteral(optionNames(battle.slots, row.slotUids)),
          // 武器图标：按武器 ID 现算成 PIC_<武器ID>（立绘模块的「武器图标」页也是这一条）
          weaponIconId(row.id),
          // 武器类：前缀 + BP_Weapon_<武器ID去WEA_>；拼不出来时按样例写 None
          weaponClassOf(battle, row.id),
        ]),
    ],
  };
}
