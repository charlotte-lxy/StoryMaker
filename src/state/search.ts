/**
 * 全局搜索。
 *
 * 把各模块的条目拉平成一串「可搜的记录」，按关键词做不区分大小写的模糊匹配，
 * 命中后按模块分组返回，由界面负责跳转。
 *
 * 每个模块里的「第几行」按界面上实际的显示顺序数（属性表从上往下第几条、
 * 本地化表第几行、指令字典里条件/指令各自第几条），所以结果里标的行号
 * 跟眼睛看到的对得上。要跳的行由界面按 uid 找，这里只负责给出目标。
 */

import { collectLocaleEntries } from '../core/localization';
import type { GasModifier, GasPair, Project } from '../core/types';
import type { BattlePage } from './battle-operations';

/** 能被搜的模块，也是搜索页最上面那排筛选按钮的顺序 */
export type SearchModuleKey =
  | 'story'
  | 'character'
  | 'items'
  | 'quests'
  | 'images'
  | 'sounds'
  | 'command'
  | 'battle'
  | 'locale';

export const SEARCH_MODULES: { key: SearchModuleKey; label: string }[] = [
  { key: 'story', label: '剧情' },
  { key: 'character', label: '角色' },
  { key: 'items', label: '物品' },
  { key: 'quests', label: '任务' },
  { key: 'images', label: '立绘' },
  { key: 'sounds', label: '音效' },
  { key: 'command', label: '条件与指令' },
  { key: 'battle', label: '战斗' },
  { key: 'locale', label: '本地化' },
];

/** 点搜索结果之后要跳到哪儿 */
export type SearchTarget =
  /** 剧情：章节 / 段落 / 对话行 / 选项，各自有自己的跳法 */
  | { kind: 'chapter'; uid: string }
  | { kind: 'group'; uid: string }
  | { kind: 'line'; uid: string }
  | { kind: 'option'; uid: string }
  /** 战斗：先切到某个子页面，再高亮那一行 */
  | { kind: 'battle'; page: BattlePage; uid: string }
  /** 本地化：剧情本地化与 UI 本地化由那边自己按 uid 认页 */
  | { kind: 'locale'; uid: string }
  /** 其余模块的表行：切到 module 模块，再高亮带 data-search-uid 的那一行 */
  | {
      kind: 'row';
      module: 'character' | 'items' | 'quests' | 'images' | 'sounds' | 'command';
      uid: string;
    };

export interface SearchHit {
  /** 属于哪个子模块，如「效果表（GE）」「序章 / 开场」「指令字典 · 条件」 */
  submodule: string;
  /** 子模块里的第几行（从 1 开始） */
  rowNumber: number;
  /** 这一行的标识：名字 / ID / 对话 ID / 本地化 key */
  rowLabel: string;
  /** 命中的那段文字；命中的就是行标识本身时留空，免得同一句话显示两遍 */
  text: string;
  target: SearchTarget;
}

export interface SearchGroup {
  module: SearchModuleKey;
  label: string;
  /** 这一组一共命中多少条（可能多于 hits.length） */
  total: number;
  hits: SearchHit[];
}

/** 一条记录在被搜之前的样子 */
interface Draft {
  submodule: string;
  rowNumber: number;
  rowLabel: string;
  /** 参与匹配的文字，按优先级排：越靠前越可能是"这一行是什么" */
  fields: string[];
  target: SearchTarget;
}

/**
 * 每个模块最多列这么多条。
 *
 * 搜单个常用字（比如「的」）可能命中上千条，全渲染出来会卡住下拉页；
 * 组标题里会写明一共命中多少条，让人知道是被截断了。
 */
const MAX_PER_MODULE = 100;

/** 命中片段最长显示这么多字 */
const PREVIEW_LIMIT = 80;

const MODULE_LABEL = new Map(SEARCH_MODULES.map((item) => [item.key, item.label]));

/** 命中就返回命中的那段原文，没命中返回 null */
function findHit(fields: string[], needle: string): string | null {
  for (const field of fields) {
    if (field.trim() !== '' && field.toLowerCase().includes(needle)) return field;
  }
  return null;
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LIMIT ? `${oneLine.slice(0, PREVIEW_LIMIT)}…` : oneLine;
}

function pairFields(pairs: GasPair[]): string[] {
  return pairs.flatMap((pair) => [pair.key, pair.value]);
}

function modifierFields(modifiers: GasModifier[]): string[] {
  return modifiers.flatMap((row) => [row.duration, row.attribute, row.operator, row.value]);
}

/** 剧情：章节名、段落名、「章节 / 段落」下的每一行对话与每个选项 */
function storyDrafts(project: Project): Draft[] {
  const drafts: Draft[] = [];

  project.chapters.forEach((chapter, chapterIndex) => {
    const chapterLabel = chapter.title || chapter.id;
    drafts.push({
      submodule: '章节',
      rowNumber: chapterIndex + 1,
      rowLabel: chapterLabel,
      fields: [chapter.title, chapter.id],
      target: { kind: 'chapter', uid: chapter.uid },
    });

    chapter.groups.forEach((group, groupIndex) => {
      const groupLabel = group.title || group.id;
      drafts.push({
        submodule: chapterLabel,
        rowNumber: groupIndex + 1,
        rowLabel: groupLabel,
        fields: [group.title, group.id, group.note],
        target: { kind: 'group', uid: group.uid },
      });

      const where = `${chapterLabel} / ${groupLabel}`;
      group.lines.forEach((line, lineIndex) => {
        drafts.push({
          submodule: where,
          rowNumber: lineIndex + 1,
          rowLabel: line.readableId === '' ? `第 ${lineIndex + 1} 行` : line.readableId,
          fields: [
            line.readableId,
            line.text.zh,
            line.text.en,
            line.text.ja,
            line.characterId,
            line.displayName,
            line.command,
            ...line.jumpConditions,
            line.note,
          ],
          target: { kind: 'line', uid: line.uid },
        });

        // 选项挂在它所在的那条「选项」行上，所以行号跟着宿主行走
        line.optionIds.forEach((optionUid) => {
          const option = group.options.find((item) => item.uid === optionUid);
          if (option === undefined) return;
          drafts.push({
            submodule: where,
            rowNumber: lineIndex + 1,
            rowLabel: option.readableId === '' ? '选项' : option.readableId,
            fields: [
              option.readableId,
              option.text.zh,
              option.text.en,
              option.text.ja,
              ...option.appearConditions,
              ...option.enableConditions,
              ...option.results,
            ],
            target: { kind: 'option', uid: option.uid },
          });
        });
      });
    });
  });

  return drafts;
}

function characterDrafts(project: Project): Draft[] {
  return project.characters.map((character, index) => ({
    submodule: '角色表',
    rowNumber: index + 1,
    rowLabel: character.id || character.name,
    fields: [character.id, character.name, ...character.expressions, ...character.actions],
    target: { kind: 'row', module: 'character', uid: character.uid },
  }));
}

/** 物品 / 任务 / 立绘 / 音效四张表结构一样，子模块名跟各自的页面标题一致 */
const LOOKUP_LABEL: Record<'items' | 'quests' | 'images' | 'sounds', string> = {
  items: '物品表',
  quests: '任务表',
  images: '立绘 / 图片表',
  sounds: '音效表',
};

function lookupDrafts(project: Project, key: 'items' | 'quests' | 'images' | 'sounds'): Draft[] {
  return project[key].map((row, index) => ({
    submodule: LOOKUP_LABEL[key],
    rowNumber: index + 1,
    rowLabel: row.id || row.name,
    fields: [row.id, row.name],
    target: { kind: 'row', module: key, uid: row.uid },
  }));
}

/** 条件与指令：只搜字典（使用情况是收集出来的派生清单，没有可高亮的行） */
function commandDrafts(project: Project): Draft[] {
  const drafts: Draft[] = [];

  for (const category of ['条件', '指令'] as const) {
    let rowNumber = 0;
    for (const def of project.commands) {
      if (def.category !== category) continue;
      rowNumber += 1;
      drafts.push({
        submodule: `指令字典 · ${category}`,
        rowNumber,
        rowLabel: def.branch === '' ? def.head : `${def.head}.${def.branch}`,
        fields: [def.head, def.branch, def.attribute, def.operator, def.note, ...def.fixedValues],
        target: { kind: 'row', module: 'command', uid: def.uid },
      });
    }
  }

  return drafts;
}

/** 战斗：六张主表各搜各的；GameplayTags 管理器是收集出来的，条目都在源表里 */
function battleDrafts(project: Project): Draft[] {
  const battle = project.battle;
  const drafts: Draft[] = [];

  battle.attributes.forEach((row, index) => {
    drafts.push({
      submodule: '属性表（AS）',
      rowNumber: index + 1,
      rowLabel: row.name,
      fields: [row.name, row.note, row.tagNote],
      target: { kind: 'battle', page: 'attributes', uid: row.uid },
    });
  });

  battle.events.forEach((row, index) => {
    drafts.push({
      submodule: '事件表（Event）',
      rowNumber: index + 1,
      rowLabel: row.name,
      fields: [row.name, row.note, row.tagNote],
      target: { kind: 'battle', page: 'events', uid: row.uid },
    });
  });

  battle.effects.forEach((row, index) => {
    drafts.push({
      submodule: '效果表（GE）',
      rowNumber: index + 1,
      rowLabel: row.name,
      fields: [
        row.name,
        row.note,
        row.className,
        row.tagNote,
        row.duration,
        row.period,
        row.reduceStacks,
        row.maxStacks,
        ...modifierFields(row.modifiers),
      ],
      target: { kind: 'battle', page: 'effects', uid: row.uid },
    });
  });

  battle.skills.forEach((row, index) => {
    drafts.push({
      submodule: '技能表（GA）',
      rowNumber: index + 1,
      rowLabel: row.name,
      fields: [
        row.name,
        row.className,
        row.tagNote,
        ...row.lockSkills,
        ...row.listenEvents,
        ...pairFields(row.parameters),
      ],
      target: { kind: 'battle', page: 'skills', uid: row.uid },
    });
  });

  battle.characters.forEach((row, index) => {
    drafts.push({
      submodule: '角色预设',
      rowNumber: index + 1,
      rowLabel: row.id || row.name,
      fields: [row.id, row.name, ...pairFields(row.attributes), ...row.skills],
      target: { kind: 'battle', page: 'characters', uid: row.uid },
    });
  });

  battle.weapons.forEach((row, index) => {
    drafts.push({
      submodule: '武器表',
      rowNumber: index + 1,
      rowLabel: row.id || row.name,
      fields: [
        row.id,
        row.name,
        row.description,
        row.magazine,
        row.attackSpeed,
        ...modifierFields(row.modifiers),
        ...row.skills,
      ],
      target: { kind: 'battle', page: 'weapons', uid: row.uid },
    });
  });

  return drafts;
}

/**
 * 本地化：剧情本地化与 UI 本地化各自算一个子模块。
 *
 * 剧情那一页的行号用的是 collectLocaleEntries 的顺序——和本地化页面上看到的一致。
 */
function localeDrafts(project: Project): Draft[] {
  const drafts: Draft[] = [];

  collectLocaleEntries(project).forEach((entry, index) => {
    drafts.push({
      submodule: '剧情本地化',
      rowNumber: index + 1,
      rowLabel: entry.key,
      fields: [entry.key, entry.text.zh, entry.text.en, entry.text.ja],
      target: { kind: 'locale', uid: entry.uid },
    });
  });

  project.uiTexts.forEach((row, index) => {
    drafts.push({
      submodule: 'UI 本地化',
      rowNumber: index + 1,
      rowLabel: row.key,
      fields: [row.key, row.text.zh, row.text.en, row.text.ja],
      target: { kind: 'locale', uid: row.uid },
    });
  });

  return drafts;
}

/** 把一组记录按关键词过一遍，一条都没命中就返回 null（界面上整组不显示） */
function groupOf(module: SearchModuleKey, drafts: Draft[], needle: string): SearchGroup | null {
  const hits: SearchHit[] = [];

  for (const draft of drafts) {
    const matched = findHit(draft.fields, needle);
    if (matched === null) continue;
    hits.push({
      submodule: draft.submodule,
      rowNumber: draft.rowNumber,
      rowLabel: draft.rowLabel,
      text: matched === draft.rowLabel ? '' : shorten(matched),
      target: draft.target,
    });
  }

  if (hits.length === 0) return null;
  return {
    module,
    label: MODULE_LABEL.get(module) ?? module,
    total: hits.length,
    hits: hits.slice(0, MAX_PER_MODULE),
  };
}

/**
 * 按关键词搜项目。
 *
 * only 为 null 表示「全部」模块；空关键词直接返回空数组（不搜等于不显示结果）。
 */
export function searchProject(
  project: Project,
  query: string,
  only: SearchModuleKey | null = null,
): SearchGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const builders: { module: SearchModuleKey; drafts: () => Draft[] }[] = [
    { module: 'story', drafts: () => storyDrafts(project) },
    { module: 'character', drafts: () => characterDrafts(project) },
    { module: 'items', drafts: () => lookupDrafts(project, 'items') },
    { module: 'quests', drafts: () => lookupDrafts(project, 'quests') },
    { module: 'images', drafts: () => lookupDrafts(project, 'images') },
    { module: 'sounds', drafts: () => lookupDrafts(project, 'sounds') },
    { module: 'command', drafts: () => commandDrafts(project) },
    { module: 'battle', drafts: () => battleDrafts(project) },
    { module: 'locale', drafts: () => localeDrafts(project) },
  ];

  const groups: SearchGroup[] = [];
  for (const builder of builders) {
    if (only !== null && only !== builder.module) continue;
    const group = groupOf(builder.module, builder.drafts(), needle);
    if (group !== null) groups.push(group);
  }
  return groups;
}
