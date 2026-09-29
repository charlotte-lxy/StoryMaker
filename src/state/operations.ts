/**
 * 项目状态操作。
 *
 * 所有修改都走 mutate()：先结构化克隆再改，避免 React 状态被就地篡改。
 */

import { createEmptyBattle } from '../core/battle';
import { EXPORT_SUBTABLES } from '../core/export-settings';
import { makeLineId, makeOptionId, newUid, renumberGroup, groupUidOfFirstLine, type IdChange } from '../core/ids';
import type {
  Chapter,
  CommandDef,
  ExportSettingRow,
  Group,
  LangKey,
  Line,
  LineKind,
  LocalizedText,
  LookupRow,
  Project,
  StoryOption,
  TargetKind,
  UiTextRow,
  ValueKind,
} from '../core/types';

/**
 * 默认指令字典，整理自 tb-gal.xlsx 的【条件指令汇总】。
 * 「条件」用于选项的出现/可用条件，「指令」用于「指令」行与选项的结果。
 * 地图与 CG 相关的条目没有收录——那部分留给其他项目。
 */
export function defaultCommandDefs(): CommandDef[] {
  const def = (
    category: '条件' | '指令',
    head: string,
    branch: string,
    target: TargetKind,
    attribute: string,
    operator: string,
    value: ValueKind,
    note: string,
    fixedValues: string[] = [],
  ): CommandDef => ({
    uid: newUid(),
    category,
    head,
    branch,
    target,
    attribute,
    operator,
    value,
    fixedValues,
    note,
  });

  return [
    // ---- 条件 ----
    def('条件', '背包', '', 'item', '', '>=', 'number', '物品数量判断：大于等于'),
    def('条件', '背包', '', 'item', '', '<=', 'number', '物品数量判断：小于等于'),
    def('条件', '背包', '', 'item', '', '==', 'number', '物品数量判断：等于'),
    def('条件', '背包', '', 'item', '', '>', 'number', '物品数量判断：大于'),
    def('条件', '背包', '', 'item', '', '<', 'number', '物品数量判断：小于'),
    def('条件', '任务', '', 'quest', '', '=', 'fixed', '任务完成判断：完成', ['1']),
    def('条件', '任务', '', 'quest', '', '=', 'fixed', '任务完成判断：未完成', ['0']),
    def('条件', '剧情', '', 'line', '', '=', 'fixed', '对话完成判断：完成', ['1']),
    def('条件', '剧情', '', 'line', '', '=', 'fixed', '对话完成判断：未完成', ['0']),
    def('条件', '特殊', '', 'manual', '', '=', 'fixed', '特殊条件，正常表达式判断不了的情况，需和程序提前沟通', ['1']),
    def('条件', '特殊', '', 'manual', '', '=', 'fixed', '特殊条件（未完成）', ['0']),

    // ---- 指令 ----
    def('指令', '剧情.演出', '立绘进入', 'character', '进入', '=', 'fixed', '角色需先进入后才能操作表情与动作', ['1']),
    def('指令', '剧情.演出', '立绘退出', 'character', '退出', '=', 'fixed', '角色下场', ['1']),
    def('指令', '剧情.演出', '设置表情', 'character', '表情', '=', 'expression', '表情清单在角色表里配置'),
    def('指令', '剧情.演出', '设置动作', 'character', '动作', '=', 'action', '动作清单在角色表里配置'),
    def('指令', '剧情.图片', '', 'image', '', '', 'none', '展示图片，图片 ID 来自立绘表'),
    def('指令', '剧情.图片', '移除图片', 'manual', '', '', 'none', '填「移除」，清掉当前图片'),
    def('指令', '剧情.播放对话', '', 'line', '', '', 'none', '直接跳去播另一段对话'),
    def('指令', '背包', '', 'item', '', '+', 'number', '增加物品数量'),
    def('指令', '背包', '', 'item', '', '-', 'number', '减少物品数量'),
    def('指令', '背包', '', 'item', '', '=', 'number', '直接设置物品数量'),
    def('指令', '任务.接取', '', 'quest', '', '', 'none', '接取任务'),
    def('指令', '特殊', '', 'manual', '', '', 'none', '正常表达式写不出来的指令，需和程序提前沟通'),
  ];
}

export function createLine(
  chapterId: string,
  groupId: string,
  index: number,
  kind: LineKind = '对话',
): Line {
  return {
    uid: newUid(),
    readableId: makeLineId(chapterId, groupId, index),
    kind,
    characterId: '',
    displayName: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    command: '',
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
  };
}

/**
 * 能拖进对话列表的脚本块：三种行类型，外加「跳转到段落」。
 *
 * 「跳转到段落」生成的是「指令」行（导出时文本类型就是指令），
 * 只是它的指令内容由所选段落现拼，所以要单独区分开。
 */
export type InsertKind = LineKind | '跳转到段落';

export const JUMP_BLOCK = '跳转到段落';

export function createOption(hostLineId: string, index: number): StoryOption {
  return {
    uid: newUid(),
    readableId: makeOptionId(hostLineId, index),
    text: { zh: '', en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
    results: [],
  };
}

export function createEmptyProject(name = '未命名项目'): Project {
  return {
    version: 1,
    name,
    characters: [],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: defaultCommandDefs(),
    variables: [],
    uiTexts: [],
    battle: createEmptyBattle(),
    exportSettings: [],
    chapters: [
      {
        uid: newUid(),
        id: 'ch01',
        title: '序章',
        groups: [
          {
            uid: newUid(),
            id: '001',
            title: '开场',
            note: '',
            lines: [createLine('ch01', '001', 1)],
            options: [],
          },
        ],
      },
    ],
  };
}

export function mutate(project: Project, fn: (draft: Project) => void): Project {
  const draft = structuredClone(project);
  fn(draft);
  return draft;
}

export interface GroupLocation {
  chapter: Chapter;
  group: Group;
}

export function locateGroup(project: Project, groupUid: string): GroupLocation | undefined {
  for (const chapter of project.chapters) {
    const group = chapter.groups.find((g) => g.uid === groupUid);
    if (group !== undefined) return { chapter, group };
  }
  return undefined;
}

export function findGroup(project: Project, groupUid: string): Group | undefined {
  return locateGroup(project, groupUid)?.group;
}

/** 一个对话行在跳转目标下拉框里的条目 */
export interface LineRef {
  uid: string;
  readableId: string;
  preview: string;
}

/** 按章节 / 段落分组的对话行，供跳转目标的两级下拉联动 */
export interface GroupLineRefs {
  groupUid: string;
  label: string;
  lines: LineRef[];
}

export function collectGroupedLineRefs(project: Project): GroupLineRefs[] {
  const groups: GroupLineRefs[] = [];
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      groups.push({
        groupUid: group.uid,
        label: `${chapter.title || chapter.id} / ${group.title || group.id}`,
        lines: group.lines.map((line) => ({
          uid: line.uid,
          readableId: line.readableId,
          preview: previewOf(line, group),
        })),
      });
    }
  }
  return groups;
}

/** 跳转目标下拉里的预览文字：按类型取最像"内容"的那一段 */
function previewOf(line: Line, group: Group): string {
  if (line.kind === '指令') return line.command.trim().slice(0, 18);
  if (line.kind === '选项') {
    const first = line.optionIds
      .map((uid) => group.options.find((o) => o.uid === uid))
      .find((option) => option !== undefined);
    return first === undefined ? '' : first.text.zh.slice(0, 18);
  }
  return line.text.zh.slice(0, 18);
}

/** 反查某个对话行属于哪个段落，用于回填两级下拉的第一级 */
export function groupUidOfLine(grouped: GroupLineRefs[], lineUid: string): string {
  if (lineUid === '') return '';
  // 「跳转到首句对话」记的是段落 uid，直接就是第一级要的值
  const byFirstLine = groupUidOfFirstLine(lineUid);
  if (byFirstLine !== null) return byFirstLine;
  for (const group of grouped) {
    if (group.lines.some((line) => line.uid === lineUid)) return group.groupUid;
  }
  return '';
}

export interface RenumberResult {
  project: Project;
  changes: IdChange[];
}

/** 全部重排可读 ID，并给出新旧对照表（用于同步本地化表） */
export function renumberProject(project: Project): RenumberResult {
  const draft = structuredClone(project);
  const changes: IdChange[] = [];
  for (const chapter of draft.chapters) {
    for (const group of chapter.groups) {
      changes.push(...renumberGroup(group, chapter.id));
    }
  }
  return { project: draft, changes };
}

export function addChapter(project: Project): Project {  return mutate(project, (draft) => {
    const n = draft.chapters.length + 1;
    const id = `ch${String(n).padStart(2, '0')}`;
    draft.chapters.push({
      uid: newUid(),
      id,
      title: `第 ${n} 章`,
      groups: [
        { uid: newUid(), id: '001', title: '开场', note: '', lines: [createLine(id, '001', 1)], options: [] },
      ],
    });
  });
}

export function addGroup(project: Project, chapterUid: string): Project {
  return mutate(project, (draft) => {
    const chapter = draft.chapters.find((c) => c.uid === chapterUid);
    if (chapter === undefined) return;
    const n = chapter.groups.length + 1;
    const id = String(n).padStart(3, '0');
    chapter.groups.push({
      uid: newUid(),
      id,
      title: `段落 ${n}`,
      note: '',
      lines: [createLine(chapter.id, id, 1)],
      options: [],
    });
  });
}

/**
 * 在 index 位置插入一行。
 *
 * index 是插入点（0 表示插到最前面，等于行数表示追加到末尾），
 * 与拖拽时显示的插入标记一一对应。
 */
export function insertLine(
  project: Project,
  groupUid: string,
  index: number,
  kind: InsertKind,
): Project {
  return mutate(project, (draft) => {
    const location = locateGroup(draft, groupUid);
    if (location === undefined) return;
    const { chapter, group } = location;
    const at = Math.max(0, Math.min(index, group.lines.length));
    // 「跳转到段落」也是一条指令行，只是多带一个段落引用（还没选时是空串）
    const jump = kind === JUMP_BLOCK;
    const line = createLine(
      chapter.id,
      group.id,
      group.lines.length + 1,
      jump ? '指令' : kind,
    );
    if (jump) line.jumpGroupUid = '';
    // 「选项」行默认带一个选项，省得策划还要先点一下加号
    if (kind === '选项') {
      const option = createOption(line.readableId, 0);
      group.options.push(option);
      line.optionIds.push(option.uid);
    }
    group.lines.splice(at, 0, line);
  });
}

export function removeLine(project: Project, groupUid: string, lineUid: string): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;
    const line = group.lines.find((l) => l.uid === lineUid);
    if (line === undefined) return;
    // 连同它挂着的选项一起删掉，避免留下孤儿
    group.options = group.options.filter((o) => !line.optionIds.includes(o.uid));
    group.lines = group.lines.filter((l) => l.uid !== lineUid);
  });
}

/** 批量删除：一次删掉多行，连同它们挂着的选项一起删掉，避免留下孤儿 */
export function removeLines(project: Project, groupUid: string, lineUids: string[]): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;
    const removing = new Set(lineUids);
    const droppedOptions = new Set<string>();
    for (const line of group.lines) {
      if (!removing.has(line.uid)) continue;
      for (const optionUid of line.optionIds) droppedOptions.add(optionUid);
    }
    group.options = group.options.filter((o) => !droppedOptions.has(o.uid));
    group.lines = group.lines.filter((l) => !removing.has(l.uid));
  });
}

/**
 * 批量移动到目标段落：插到开头或末尾。
 *
 * 「选项」行的选项跟着一起搬；两边都重排一次可读 ID，
 * 因为搬到别的章节时 ID 前缀（章节 + 段落号）整个都要换。
 * 目标是当前段落时，就变成"把勾中的行挪到本段最前 / 最后"。
 */
export function moveLines(
  project: Project,
  fromGroupUid: string,
  lineUids: string[],
  toGroupUid: string,
  position: 'start' | 'end' = 'end',
): Project {
  const moved = mutate(project, (draft) => {
    const from = locateGroup(draft, fromGroupUid);
    const to = locateGroup(draft, toGroupUid);
    if (from === undefined || to === undefined) return;

    const moving = new Set(lineUids);
    const movedLines = from.group.lines.filter((line) => moving.has(line.uid));
    if (movedLines.length === 0) return;
    // 同一段落里换位置：不搬去别处，直接把整组挪到最前 / 最后
    if (fromGroupUid === toGroupUid) return;

    const movedOptions = new Set<string>();
    for (const line of movedLines) {
      for (const optionUid of line.optionIds) movedOptions.add(optionUid);
    }
    const carried = from.group.options.filter((o) => movedOptions.has(o.uid));

    from.group.lines = from.group.lines.filter((line) => !moving.has(line.uid));
    from.group.options = from.group.options.filter((o) => !movedOptions.has(o.uid));
    if (position === 'start') to.group.lines.unshift(...movedLines);
    else to.group.lines.push(...movedLines);
    to.group.options.push(...carried);

    renumberGroup(from.group, from.chapter.id);
    renumberGroup(to.group, to.chapter.id);
  });

  if (fromGroupUid !== toGroupUid) return moved;
  // 同段落：按"整组搬"的算法挪到最前 / 最后
  const lines = findGroup(moved, fromGroupUid)?.lines.length ?? 0;
  return moveLinesTogether(moved, fromGroupUid, lineUids, position === 'start' ? 0 : lines);
}

/**
 * 批量拖拽排序：把勾中的若干行当成一整块，插到 insertAt 那个位置。
 *
 * insertAt 是"插到原列表第几行之前"（0 表示最前，等于行数表示最后），与拖拽时
 * 显示的插入标记一一对应。勾中的行保持原来的先后顺序，不会因为拖动互相调换。
 * 例：ABCDE 里勾了 C、E 拖到 A 与 B 之间（insertAt=1），得到 ACEBD。
 */
export function moveLinesTogether(
  project: Project,
  groupUid: string,
  lineUids: string[],
  insertAt: number,
): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;

    const moving = new Set(lineUids);
    const dragged = group.lines.filter((line) => moving.has(line.uid));
    // 一行都没勾上、或者整段都勾上了，搬了等于没搬
    if (dragged.length === 0 || dragged.length === group.lines.length) return;

    // 插入点换算到"搬走之后"的列表里：数一下它前面还剩几行没被搬走
    let target = 0;
    for (let index = 0; index < Math.min(insertAt, group.lines.length); index += 1) {
      if (!moving.has(group.lines[index].uid)) target += 1;
    }

    const rest = group.lines.filter((line) => !moving.has(line.uid));
    rest.splice(target, 0, ...dragged);
    group.lines = rest;
  });
}

/** 拖拽排序：把 from 位置的行移动到 to 位置 */
export function reorderLine(
  project: Project,
  groupUid: string,
  from: number,
  to: number,
): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;
    if (from === to) return;
    if (from < 0 || to < 0 || from >= group.lines.length || to >= group.lines.length) return;
    const [moved] = group.lines.splice(from, 1);
    group.lines.splice(to, 0, moved);
  });
}

/** 重排某个段落内的可读 ID（拖拽后自动调用） */
export function renumberOneGroup(project: Project, groupUid: string): Project {
  return mutate(project, (draft) => {
    const location = locateGroup(draft, groupUid);
    if (location === undefined) return;
    renumberGroup(location.group, location.chapter.id);
  });
}

export function addOption(project: Project, groupUid: string, lineUid: string): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;
    const line = group.lines.find((l) => l.uid === lineUid);
    if (line === undefined) return;
    const option = createOption(line.readableId, line.optionIds.length);
    group.options.push(option);
    line.optionIds.push(option.uid);
  });
}

export function removeOption(project: Project, groupUid: string, optionUid: string): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group === undefined) return;
    group.options = group.options.filter((o) => o.uid !== optionUid);
    for (const line of group.lines) {
      line.optionIds = line.optionIds.filter((uid) => uid !== optionUid);
    }
  });
}

export function removeGroup(project: Project, groupUid: string): Project {
  return mutate(project, (draft) => {
    for (const chapter of draft.chapters) {
      if (!chapter.groups.some((g) => g.uid === groupUid)) continue;
      chapter.groups = chapter.groups.filter((g) => g.uid !== groupUid);
      return;
    }
  });
}

export function removeChapter(project: Project, chapterUid: string): Project {
  return mutate(project, (draft) => {
    draft.chapters = draft.chapters.filter((c) => c.uid !== chapterUid);
  });
}

/** 改章节名：只是个给人看的标签，不影响 ID 与导出 */
export function renameChapter(project: Project, chapterUid: string, title: string): Project {
  return mutate(project, (draft) => {
    if (title.trim() === '') return;
    const chapter = draft.chapters.find((c) => c.uid === chapterUid);
    if (chapter !== undefined) chapter.title = title;
  });
}

/** 改段落名；空名字忽略，免得把段落变成没名字的 */
export function renameGroup(project: Project, groupUid: string, title: string): Project {
  return mutate(project, (draft) => {
    if (title.trim() === '') return;
    const group = findGroup(draft, groupUid);
    if (group !== undefined) group.title = title;
  });
}

/** 写段落注释（只在流程图里显示，不导出） */
export function setGroupNote(project: Project, groupUid: string, note: string): Project {
  return mutate(project, (draft) => {
    const group = findGroup(draft, groupUid);
    if (group !== undefined) group.note = note;
  });
}

/* ---------- 角色表 ---------- */
export function addCharacter(project: Project): Project {
  return mutate(project, (draft) => {
    const taken = new Set(draft.characters.map((c) => c.id));
    let n = draft.characters.length + 1;
    while (taken.has(`CHA_角色${n}`)) n += 1;
    draft.characters.push({
      uid: newUid(),
      id: `CHA_角色${n}`,
      name: `角色${n}`,
      // 建角色时给一份常用默认表情，可自行增删
      expressions: ['默认', '开心', '生气', '悲伤', '害羞'],
      actions: ['默认'],
    });
  });
}

export function removeCharacter(project: Project, characterUid: string): Project {
  return mutate(project, (draft) => {
    draft.characters = draft.characters.filter((c) => c.uid !== characterUid);
  });
}

/* ---------- 数据表（物品 / 任务 / 立绘 / 音效） ---------- */

export type LookupKind = 'items' | 'quests' | 'images' | 'sounds';

const LOOKUP_ID_PREFIX: Record<LookupKind, string> = {
  items: 'Item_',
  quests: 'Task_',
  images: 'SCE_',
  sounds: 'S_',
};

export function addLookupRow(project: Project, kind: LookupKind): Project {
  return mutate(project, (draft) => {
    const rows = draft[kind];
    const prefix = LOOKUP_ID_PREFIX[kind];
    const taken = new Set(rows.map((row) => row.id));
    let n = rows.length + 1;
    while (taken.has(`${prefix}${n}`)) n += 1;
    rows.push({ uid: newUid(), id: `${prefix}${n}`, name: '' });
  });
}

export function removeLookupRow(project: Project, kind: LookupKind, uid: string): Project {
  return mutate(project, (draft) => {
    draft[kind] = draft[kind].filter((row) => row.uid !== uid);
  });
}

export function updateLookupRow(
  project: Project,
  kind: LookupKind,
  uid: string,
  patch: Partial<LookupRow>,
): Project {
  return mutate(project, (draft) => {
    const row = draft[kind].find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/* ---------- 指令字典 ---------- */

export function addCommandDef(project: Project, category: '条件' | '指令' = '指令'): Project {
  return mutate(project, (draft) => {
    draft.commands.push({
      uid: newUid(),
      category,
      head: '新指令',
      branch: '',
      target: 'manual',
      attribute: '',
      operator: '',
      value: 'none',
      fixedValues: [],
      note: '',
    });
  });
}

export function removeCommandDef(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    draft.commands = draft.commands.filter((def) => def.uid !== uid);
  });
}

export function updateCommandDef(
  project: Project,
  uid: string,
  patch: Partial<CommandDef>,
): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === uid);
    if (def !== undefined) Object.assign(def, patch);
  });
}

/* ---------- 指令 ---------- */

/** 指令的通用结构，用于展示，也是后续做成下拉表单的基础 */
export interface ParsedCommand {
  /** 指令名，如「剧情」 */
  name: string;
  /** 指令分支，如「人物」「特殊」「音效」 */
  branch: string;
  /** 目标对象，如角色 ID、特效编号、音效名 */
  target: string;
  /** 目标属性，可省略，如「差分」 */
  attribute: string;
  /** 指令运算符，可省略，如「=」 */
  operator: string;
  /** 目标结果，可省略，如「挥手」 */
  value: string;
}

/**
 * 解析指令：主指令[.分支]# 目标对象[.目标属性][运算符 目标结果]
 *
 * 方括号部分都可以省略，所以拆解要小心两处歧义：
 *   1. `背包# Like_西园寺雪+1` 的 `+1` 是运算符加数值，不能并进目标
 *   2. `剧情.播放对话# P_Test_001-1` 的 `-1` 是 ID 的一部分，不是减法
 * 因此先看整体是否就是「ID-数字」这种形状，是的话整个当目标。
 */
export function parseCommand(text: string): ParsedCommand | null {
  const head = /^\s*([^.#]+)(?:\.([^#]+))?#\s*(.*?)\s*$/.exec(text);
  if (head === null) return null;

  const name = head[1].trim();
  const branch = (head[2] ?? '').trim();
  const rest = head[3];

  const base = { name, branch, attribute: '', operator: '', value: '' };

  // 整体就是一个带尾号的 ID，例如 P_Test_001-1、Task_Test_01
  const plainId = /^([A-Za-z][A-Za-z0-9_]*-\d+)$/.exec(rest);
  if (plainId !== null) return { ...base, target: plainId[1] };

  const withValue = /^([^.\s]+?)(?:\.([^\s=+\-]+))?\s*(>=|<=|==|!=|>|<|\+|-|=)\s*(.*?)$/.exec(
    rest,
  );
  if (withValue !== null) {
    return {
      name,
      branch,
      target: withValue[1],
      attribute: withValue[2] ?? '',
      operator: withValue[3],
      value: withValue[4],
    };
  }

  const targetOnly = /^([^.\s]+?)(?:\.([^\s=+\-]+))?$/.exec(rest);
  if (targetOnly !== null) {
    return { ...base, target: targetOnly[1], attribute: targetOnly[2] ?? '' };
  }

  return null;
}

export interface CommandLocation {
  groupUid: string;
  lineUid: string;
  lineId: string;
  groupLabel: string;
}

export interface CommandUsage {
  text: string;
  count: number;
  parsed: ParsedCommand | null;
  locations: CommandLocation[];
}

/** 汇总剧情中用到的全部指令（只有「指令」行会写指令），按文本去重 */
export function collectCommands(project: Project): CommandUsage[] {
  const map = new Map<string, CommandUsage>();

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const groupLabel = `${chapter.title || chapter.id} / ${group.title || group.id}`;
      for (const line of group.lines) {
        if (line.kind !== '指令') continue;
        const text = line.command.trim();
        if (text === '') continue;

        let entry = map.get(text);
        if (entry === undefined) {
          entry = { text, count: 0, parsed: parseCommand(text), locations: [] };
          map.set(text, entry);
        }
        entry.count += 1;
        entry.locations.push({
          groupUid: group.uid,
          lineUid: line.uid,
          lineId: line.readableId,
          groupLabel,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => a.text.localeCompare(b.text, 'zh'));
}

/** 批量改写某条指令：所有出现处一起替换 */
export function renameCommand(project: Project, from: string, to: string): Project {
  return mutate(project, (draft) => {
    for (const chapter of draft.chapters) {
      for (const group of chapter.groups) {
        for (const line of group.lines) {
          if (line.kind === '指令' && line.command.trim() === from) line.command = to;
        }
      }
    }
  });
}

/* ---------- 本地化 ---------- */

/**
 * 按 uid 改写对话行或选项某一语言的文本。
 *
 * 因为文本挂在 uid 上，重排可读 ID 不会影响这里的内容，
 * 所以本地化模块不需要任何额外的同步逻辑。
 */
export function updateTextByUid(
  project: Project,
  uid: string,
  lang: LangKey,
  value: string,
): Project {
  return mutate(project, (draft) => {
    for (const chapter of draft.chapters) {
      for (const group of chapter.groups) {
        const line = group.lines.find((l) => l.uid === uid);
        if (line !== undefined) {
          line.text[lang] = value;
          return;
        }
        const option = group.options.find((o) => o.uid === uid);
        if (option !== undefined) {
          option.text[lang] = value;
          return;
        }
      }
    }
  });
}

/* ---------- UI 本地化 ---------- */

/**
 * UI 本地化表的增删改。
 *
 * 这些条目不来自剧本，是程序给的界面文案清单，因此在界面上单独维护，
 * 改 key 不牵连任何引用。
 */
export function addUiText(project: Project, key: string, text: LocalizedText): Project {
  return mutate(project, (draft) => {
    // 插到最前面：刚填完就能在列表顶上核对这一条
    draft.uiTexts.unshift({ uid: newUid(), key: key.trim(), text: { ...text } });
  });
}

export function removeUiText(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    draft.uiTexts = draft.uiTexts.filter((row) => row.uid !== uid);
  });
}

export function updateUiText(project: Project, uid: string, patch: Partial<UiTextRow>): Project {
  return mutate(project, (draft) => {
    const row = draft.uiTexts.find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, patch);
  });
}

/* ---------- Unreal 导入设置 ---------- */

export function addExportSetting(project: Project): Project {
  return mutate(project, (draft) => {
    const taken = new Set(draft.exportSettings.map((row) => row.tableName));
    let n = draft.exportSettings.length + 1;
    while (taken.has(`TB_新数据表${n}`)) n += 1;
    draft.exportSettings.push({
      uid: newUid(),
      tableName: `TB_新数据表${n}`,
      folder: '',
      // 子表默认挑第一个，省得还要点一下下拉
      subTable: EXPORT_SUBTABLES[0],
    });
  });
}

export function removeExportSetting(project: Project, uid: string): Project {
  return mutate(project, (draft) => {
    draft.exportSettings = draft.exportSettings.filter((row) => row.uid !== uid);
  });
}

export function updateExportSetting(
  project: Project,
  uid: string,
  patch: Partial<ExportSettingRow>,
): Project {
  return mutate(project, (draft) => {
    const row = draft.exportSettings.find((item) => item.uid === uid);
    if (row !== undefined) Object.assign(row, patch);
  });
}
