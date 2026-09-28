/**
 * 战斗模块（GAS）的导出：7 张子表，都是「策划填的中间列 + 公式列」里的最终结果。
 *
 * 和剧情那边一个思路：中间输入列（带「（多选）」「（换行分割）」后缀的）
 * 与 Tag / DevComment 不进导出表，导出的只有 Unreal 要的最终列。
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
} from './battle';
import type { GasPair, Project } from './types';

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
  '类名',
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
  '类名',
  '锁定GA列表',
  '监听事件列表',
  '参数赋值列表',
  'GA类',
];
export const EVENT_HEADER: readonly string[] = ['', '事件名', '事件标签'];
export const CHARACTER_HEADER: readonly string[] = ['', '角色名', '属性列表', '技能列表'];
export const WEAPON_HEADER: readonly string[] = [
  '',
  '武器名',
  '武器描述',
  '弹匣容量',
  '攻击速度',
  '修改器列表',
  '技能列表',
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

/** 角色 / 武器的技能列表存的是技能名，导出成技能 Tag */
const skillTags = (names: readonly string[]): string[] =>
  names.map(skillTag).filter((tag) => tag !== '');

/** 角色属性列表的 key 是属性名，导出成属性 Tag */
const attributePairs = (pairs: readonly GasPair[]): GasPair[] =>
  pairs
    .filter((pair) => pair.key.trim() !== '')
    .map((pair) => ({ ...pair, key: attributeTag(pair.key) }));

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
          row.className.trim(),
          row.duration,
          row.period,
          boolText(row.periodImmediate),
          row.reduceStacks,
          row.maxStacks,
          boolText(row.refreshDuration),
          boolText(row.refreshPeriod),
          formatArrayLiteral(modifierTexts(row.modifiers)),
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
          row.className.trim(),
          formatArrayLiteral(row.lockSkills.map(skillTag).filter((tag) => tag !== '')),
          formatArrayLiteral(row.listenEvents.map(eventTag).filter((tag) => tag !== '')),
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
          formatPairLiteral(attributePairs(filledPairs(row.attributes))),
          formatArrayLiteral(skillTags(row.skills)),
        ]),
    ],
    weapons: [
      [...WEAPON_HEADER],
      ...battle.weapons
        .filter((row) => row.id.trim() !== '' || row.name.trim() !== '')
        .map((row) => [
          row.id.trim(),
          row.name,
          row.description,
          row.magazine,
          row.attackSpeed,
          formatArrayLiteral(modifierTexts(row.modifiers)),
          formatArrayLiteral(skillTags(row.skills)),
        ]),
    ],
  };
}
