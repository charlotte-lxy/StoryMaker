/**
 * 战斗模块（GAS）的公共规则。
 *
 * Tag 一律由「模块前缀 + 名字」现算，不另外存一份：改名之后旧 Tag 不会留在数据里，
 * 导出的 GameplayTags 表也就永远和几张表对得上。
 */

import type { BattleData, GasModifier, GasPair, Project } from './types';
/** 各模块的 Tag 前缀 */
export const TAG_PREFIX = {
  attribute: 'GAS.属性.',
  effect: 'GAS.效果.',
  skill: 'GAS.技能.',
  event: 'GAS.事件.',
} as const;

/** 修改器的持续类型 */
export const MODIFIER_DURATIONS = ['基础', '临时', '固定'] as const;

/** 修改器的运算符 */
export const MODIFIER_OPERATORS = ['+', '-', '*', '/', '='] as const;

/** 默认的类名路径前缀：换项目时在界面上改这两条即可 */
export const DEFAULT_SKILL_CLASS_PREFIX =
  "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/GA/BSGA/";
export const DEFAULT_EFFECT_CLASS_PREFIX =
  "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/GE/BSGE/";

/** 空项目里战斗模块的样子：两张前缀表 + 六张空表 */
export function createEmptyBattle(): BattleData {
  return {
    skillClassPrefix: DEFAULT_SKILL_CLASS_PREFIX,
    effectClassPrefix: DEFAULT_EFFECT_CLASS_PREFIX,
    attributes: [],
    effects: [],
    skills: [],
    events: [],
    characters: [],
    weapons: [],
  };
}

/** 名字为空时不合成 Tag（否则会得到「GAS.属性.」这种半截 Tag） */
export function tagOf(prefix: string, name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '' : prefix + trimmed;
}

export const attributeTag = (name: string): string => tagOf(TAG_PREFIX.attribute, name);
export const effectTag = (name: string): string => tagOf(TAG_PREFIX.effect, name);
export const skillTag = (name: string): string => tagOf(TAG_PREFIX.skill, name);
export const eventTag = (name: string): string => tagOf(TAG_PREFIX.event, name);

/** 属性 / 事件表里的「属性标签」「事件标签」列：(TagName="GAS.属性.生命值") */
export function tagStructLiteral(tag: string): string {
  return tag === '' ? '' : `(TagName="${tag}")`;
}

/**
 * 修改器合成出来的文本：持续类型#属性名 运算符 值，如「基础#生命值-Damage」。
 *
 * 属性名或值还没填时不合成，免得导出一堆半截字符串。
 */
export function modifierText(modifier: GasModifier): string {
  const attribute = modifier.attribute.trim();
  const value = modifier.value.trim();
  if (attribute === '' || value === '') return '';
  return `${modifier.duration}#${attribute}${modifier.operator}${value}`;
}

/** 修改器列表的文本形式，空的一律丢掉 */
export function modifierTexts(modifiers: readonly GasModifier[]): string[] {
  return modifiers.map(modifierText).filter((text) => text !== '');
}

/** 类名补成 Unreal 需要的全路径：BP_GA_Heal → /Script/.../BP_GA_Heal.BP_GA_Heal_C' */
export function classPath(prefix: string, className: string): string {
  const trimmed = className.trim();
  if (trimmed === '') return '';
  return `${prefix}${trimmed}.${trimmed}_C'`;
}

/** 键值对数组的字面量：(("Speed","10"),("Attack","20"))；空列表返回空串 */
export function formatPairLiteral(pairs: readonly GasPair[]): string {
  const filled = pairs.filter((pair) => pair.key.trim() !== '' || pair.value.trim() !== '');
  if (filled.length === 0) return '';
  const inner = filled
    .map(
      (pair) =>
        '(' +
        '"' +
        pair.key.trim().replace(/"/g, '""') +
        '","' +
        pair.value.trim().replace(/"/g, '""') +
        '"' +
        ')',
    )
    .join(',');
  return `(${inner})`;
}

/** GameplayTags 表里的一条 */
export interface GameplayTagEntry {
  /** 来自哪张表，如「属性」 */
  group: string;
  /** 条目名 */
  name: string;
  /** 合成后的 Tag */
  tag: string;
  /** 这一条在数据里的 uid：界面用它定位、改名后也不会丢备注 */
  uid: string;
  tagNote: string;
}

/** 收集哪些表：顺序就是界面里几张表的排列顺序，也是导出顺序 */
const TAG_SOURCES: { group: string; prefix: string }[] = [
  { group: '属性', prefix: TAG_PREFIX.attribute },
  { group: '效果', prefix: TAG_PREFIX.effect },
  { group: '技能', prefix: TAG_PREFIX.skill },
  { group: '事件', prefix: TAG_PREFIX.event },
];

/**
 * 把属性 / 效果 / 技能 / 事件四张表收集成 GameplayTags 列表。
 *
 * 名字为空的条目跳过（Tag 都合成不出来），按表分组返回。
 */
export function collectGameplayTags(battle: BattleData): GameplayTagEntry[] {
  const rows: { name: string; uid: string; tagNote: string }[][] = [
    battle.attributes,
    battle.effects,
    battle.skills,
    battle.events,
  ];

  const entries: GameplayTagEntry[] = [];
  TAG_SOURCES.forEach((source, index) => {
    for (const row of rows[index]) {
      const tag = tagOf(source.prefix, row.name);
      if (tag === '') continue;
      entries.push({
        group: source.group,
        name: row.name.trim(),
        tag,
        uid: row.uid,
        tagNote: row.tagNote,
      });
    }
  });
  return entries;
}

/** 界面与导出都要的几张表的 Tag 清单（判断引用是否悬空时用） */
export function battleIndex(project: Project): {
  attributes: Set<string>;
  skills: Set<string>;
  events: Set<string>;
} {
  return {
    attributes: new Set(project.battle.attributes.map((row) => row.name.trim()).filter(Boolean)),
    skills: new Set(project.battle.skills.map((row) => row.name.trim()).filter(Boolean)),
    events: new Set(project.battle.events.map((row) => row.name.trim()).filter(Boolean)),
  };
}
