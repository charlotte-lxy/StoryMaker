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
import {
  attributeNameOf,
  characterIdOf,
  eventNameOf,
  skillNameOf,
} from '../core/refs';
import type { BattleData, GasModifier, GasPair, Project } from '../core/types';
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
  /** 行标识里要标出来的区间 */
  labelMarks: Span[];
  /**
   * 命中的另外几个字段（行标识自己不算，免得同一句话显示两遍）。
   * 每条片段自带要高亮的区间，界面上照着标黄。
   */
  snippets: SearchSnippet[];
  target: SearchTarget;
}

/** 高亮区间：[起点, 终点)，按字符串下标算 */
export type Span = [number, number];

export interface SearchSnippet {
  /** 片段原文；命中点太靠前 / 靠后时会掐掉两头并带省略号 */
  text: string;
  /** 这条片段里要高亮的区间 */
  marks: Span[];
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
  /** 参与匹配的文字，按优先级排：越靠前越可能是「这一行是什么」 */
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

/** 一条结果里最多再显示几个命中的字段（行标识之外） */
const MAX_SNIPPETS = 2;

/** 命中片段最长这么多字；命中点靠后时，前面留一点上下文 */
const SNIPPET_LIMIT = 60;
const SNIPPET_CONTEXT = 16;

const MODULE_LABEL = new Map(SEARCH_MODULES.map((item) => [item.key, item.label]));

/**
 * 关键词出现的位置，按起点排好、把重叠的并起来。
 *
 * 大小写折叠偶尔会改变长度（比如 İ），那种串上折叠后的下标对不上原文，
 * 就退回区分大小写地找——宁可漏标，也不能标错位置。
 */
function matchSpans(text: string, terms: string[]): Span[] {
  if (text === '') return [];
  const lower = text.toLowerCase();
  const haystack = lower.length === text.length ? lower : text;

  const spans: Span[] = [];
  for (const term of terms) {
    if (term === '') continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(term, from);
      if (at < 0) break;
      spans.push([at, at + term.length]);
      from = at + term.length;
    }
  }

  spans.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

/**
 * 把一个字段裁成一段能看的片段，并算出里面要高亮的位置。
 *
 * 从命中点前面留一点上下文，而不是无条件从头截：很长的一句台词里，
 * 命中的那两个字很可能在第 80 个字之后，从头截会让人看不到自己搜的词。
 */
function snippetOf(raw: string, terms: string[]): SearchSnippet | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const spans = matchSpans(text, terms);
  if (spans.length === 0) return null;

  const first = spans[0][0];
  const start = first <= SNIPPET_CONTEXT ? 0 : first - SNIPPET_CONTEXT;
  const end = Math.min(text.length, start + SNIPPET_LIMIT);
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';

  const marks: Span[] = [];
  for (const [from, to] of spans) {
    if (from >= end) break;
    marks.push([from - start + head.length, Math.min(to, end) - start + head.length]);
  }

  return { text: head + text.slice(start, end) + tail, marks };
}

function pairFields(pairs: GasPair[]): string[] {
  return pairs.flatMap((pair) => [pair.key, pair.value]);
}

function modifierFields(battle: BattleData, modifiers: GasModifier[]): string[] {
  return modifiers.flatMap((row) => [
    row.duration,
    attributeNameOf(battle, row.attributeUid),
    row.operator,
    row.value,
  ]);
}

/**
 * 引用的名字也要能搜到。
 *
 * 引用字段里存的是 uid（一长串乱码，搜它没意义），但策划想搜的是
 * 「哪些武器带了这个技能」这种问题，所以这里一律换成解析出来的名字。
 */
function characterFields(project: Project, characterUid: string): string[] {
  const ref = characterUid.trim();
  if (ref === '') return [];
  const id = characterIdOf(project, ref);
  const name = project.characters.find((row) => row.uid === ref)?.name.trim() ?? '';
  return [id, name].filter((text) => text !== '');
}

/** 战斗表里的引用列：换成解析出来的名字，一个都解析不出来时留着原值 */
function refFields(refs: readonly string[], nameOf: (ref: string) => string): string[] {
  return refs.map((ref) => ref.trim()).filter((ref) => ref !== '').map(nameOf);
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
            ...characterFields(project, line.characterUid),
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
        ...modifierFields(battle, row.modifiers),
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
        ...refFields(row.lockSkillUids, (ref) => skillNameOf(battle, ref)),
        ...refFields(row.listenEventUids, (ref) => eventNameOf(battle, ref)),
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
      fields: [
        row.id,
        row.name,
        // 属性列表的 key 是属性 uid，换成属性名才搜得到
        ...refFields(
          row.attributes.map((pair) => pair.key),
          (ref) => attributeNameOf(battle, ref),
        ),
        ...row.attributes.map((pair) => pair.value),
        ...refFields(row.skillUids, (ref) => skillNameOf(battle, ref)),
      ],
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
        ...modifierFields(battle, row.modifiers),
        ...refFields(row.skillUids, (ref) => skillNameOf(battle, ref)),
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

/**
 * 把一组记录按关键词过一遍，一条都没命中就返回 null（界面上整组不显示）。
 *
 * 多个关键词是「都要命中」：每个词出现在这行的任意一个字段里就行，不必挤在同一个字段。
 */
function groupOf(module: SearchModuleKey, drafts: Draft[], terms: string[]): SearchGroup | null {
  const hits: SearchHit[] = [];

  for (const draft of drafts) {
    const matchesRow = terms.every((term) =>
      draft.fields.some((field) => field.toLowerCase().includes(term)),
    );
    if (!matchesRow) continue;

    hits.push({
      submodule: draft.submodule,
      rowNumber: draft.rowNumber,
      rowLabel: draft.rowLabel,
      labelMarks: matchSpans(draft.rowLabel, terms),
      snippets: draft.fields
        .filter((field) => field !== draft.rowLabel)
        .map((field) => snippetOf(field, terms))
        .filter((snippet): snippet is SearchSnippet => snippet !== null)
        .slice(0, MAX_SNIPPETS),
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
 * 关键词用空格隔开，每一个都要命中（Like 中 = 同时含 Like 和 中）；
 * 命中的每一个词都会在结果里标出来。
 * only 为 null 表示「全部」模块；空关键词直接返回空数组（不搜等于不显示结果）。
 */
export function searchProject(
  project: Project,
  query: string,
  only: SearchModuleKey | null = null,
): SearchGroup[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return [];

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
    const group = groupOf(builder.module, builder.drafts(), terms);
    if (group !== null) groups.push(group);
  }
  return groups;
}
