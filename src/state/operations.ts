/**
 * 项目状态操作。
 *
 * 所有修改都走 mutate()：先结构化克隆再改，避免 React 状态被就地篡改。
 */

import { createEmptyBattle } from '../core/battle';
import { findCommandDef, formatCommandText, parseCommandText } from '../core/command-build';
import { defaultCommandDefs } from '../core/default-commands';
import { EXPORT_SUBTABLES } from '../core/export-settings';
import { makeLineId, makeOptionId, newUid, renumberGroup, groupUidOfFirstLine, type IdChange } from '../core/ids';
import { DEFAULT_SPECIAL_COMMAND_CLASS_PREFIX } from '../core/special-commands';
import {
  DEFAULT_PLAY_POSITION,
  type Chapter,
  type CharacterAlias,
  type CommandDef,
  type CommandParamDef,
  type ExportSettingRow,
  type Group,
  type LangKey,
  type Line,
  type LineKind,
  type LocalizedText,
  type LookupRow,
  type Project,
  type StoryOption,
  type UiTextRow,
} from '../core/types';

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
    characterUid: '',
    displayAliasUid: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    command: '',
    specialContent: null,
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
  };
}

/**
 * 能拖进对话列表的脚本块：三种行类型，外加「跳转到段落」与「特殊演出效果」。
 *
 * 后两种生成的都是「指令」行（导出时文本类型就是指令）：
 * 「跳转到段落」的指令内容由所选段落现拼，「特殊演出效果」的指令内容只有指令名称。
 */
export type InsertKind = LineKind | '跳转到段落' | '特殊演出效果';

export const JUMP_BLOCK = '跳转到段落';

export const SPECIAL_BLOCK = '特殊演出效果';

export function createOption(hostLineId: string, index: number): StoryOption {
  return {
    uid: newUid(),
    readableId: makeOptionId(hostLineId, index),
    text: { zh: '', en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
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
    specialCommandClassPrefix: DEFAULT_SPECIAL_COMMAND_CLASS_PREFIX,
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
    // 「跳转到段落」「特殊演出效果」也是指令行，只是各多带一个自己的字段
    const jump = kind === JUMP_BLOCK;
    const special = kind === SPECIAL_BLOCK;
    const line = createLine(
      chapter.id,
      group.id,
      group.lines.length + 1,
      jump || special ? '指令' : kind,
    );
    if (jump) line.jumpGroupUid = '';
    // 空串 = 是「特殊演出效果」行，但内容还没填（null 是普通行）
    if (special) line.specialContent = '';
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
      nameEn: '',
      nameJa: '',
      playPosition: DEFAULT_PLAY_POSITION,
      aliases: [],
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

/* ---------- 角色的别名（「显示名称」里除默认名称之外的写法） ---------- */

/** 给角色加一个空别名；行里的「别名1」「别名2」按位置算，不单独存 */
export function addCharacterAlias(project: Project, characterUid: string): Project {
  return mutate(project, (draft) => {
    const character = draft.characters.find((row) => row.uid === characterUid);
    if (character === undefined) return;
    character.aliases.push({ uid: newUid(), text: '', en: '', ja: '' });
  });
}

export function removeCharacterAlias(
  project: Project,
  characterUid: string,
  aliasUid: string,
): Project {
  return mutate(project, (draft) => {
    const character = draft.characters.find((row) => row.uid === characterUid);
    if (character === undefined) return;
    character.aliases = character.aliases.filter((alias) => alias.uid !== aliasUid);
  });
}

/** 改一个别名（别名 uid 全局唯一，按它找就行） */
export function updateCharacterAlias(
  project: Project,
  aliasUid: string,
  patch: Partial<CharacterAlias>,
): Project {
  return mutate(project, (draft) => {
    for (const character of draft.characters) {
      const alias = character.aliases.find((row) => row.uid === aliasUid);
      if (alias !== undefined) {
        Object.assign(alias, patch);
        return;
      }
    }
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

/**
 * 把一个模块（主指令）下的所有条目按「类别 + 主指令」挑出来。
 *
 * 界面按模块分组显示，新增 / 删除 / 改名都以模块为单位。
 */
export function commandModulesOf(
  project: Project,
  category: '条件' | '指令',
): { head: string; defs: CommandDef[] }[] {
  const groups = new Map<string, CommandDef[]>();
  for (const def of project.commands) {
    if (def.category !== category) continue;
    const head = def.head.trim();
    const list = groups.get(head);
    if (list === undefined) groups.set(head, [def]);
    else list.push(def);
  }
  return [...groups].map(([head, defs]) => ({ head, defs }));
}

/** 模块下还没被占用的分支名：新模块给空分支，已有条目的模块给「新分支」「新分支2」… */
function nextBranchName(defs: readonly CommandDef[]): string {
  if (defs.length === 0) return '';
  const taken = new Set(defs.map((def) => def.branch.trim()));
  let n = 1;
  while (taken.has(`新分支${n === 1 ? '' : n}`)) n += 1;
  return `新分支${n === 1 ? '' : n}`;
}

/**
 * 在剧情里把某一类（条件 / 指令）的文本按 update 改写。
 *
 * 按槽位区分类别：「指令」只改「指令」行的指令栏，「条件」只改选项的出现/可用条件
 * 与「跳转到段落」的可用条件——同一个模块名两边都有时（比如「剧情」）不会串着改。
 */
function mapCommandTexts(
  project: Project,
  category: '条件' | '指令',
  update: (text: string) => string | null,
): void {
  const apply = (text: string): string => update(text) ?? text;
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        if (category === '指令') {
          if (line.kind === '指令' && line.jumpGroupUid === null) line.command = apply(line.command);
          continue;
        }
        line.jumpConditions = line.jumpConditions.map(apply);
      }
      // 条件：所有选项（含没挂在行上的）都改
      for (const option of group.options) {
        option.appearConditions = option.appearConditions.map(apply);
        option.enableConditions = option.enableConditions.map(apply);
      }
    }
  }
}

/** 新增一个模块分组：先建一条「分支留空」的条目，再往里填分支与参数 */
export function addCommandModule(
  project: Project,
  category: '条件' | '指令',
  head: string,
): Project {
  return mutate(project, (draft) => {
    const name = head.trim();
    if (name === '') return;
    // 同一个类别里模块名不能重复
    if (draft.commands.some((def) => def.category === category && def.head.trim() === name)) return;
    draft.commands.push({ uid: newUid(), category, head: name, branch: '', params: [], note: '' });
  });
}

/** 删除整个模块分组（连同它下面的所有条目） */
export function removeCommandModule(
  project: Project,
  category: '条件' | '指令',
  head: string,
): Project {
  return mutate(project, (draft) => {
    const name = head.trim();
    draft.commands = draft.commands.filter(
      (def) => !(def.category === category && def.head.trim() === name),
    );
  });
}

/** 给某个模块加一条新条目（分支名自动避开已占用的） */
export function addCommandDef(
  project: Project,
  category: '条件' | '指令',
  head: string,
): Project {
  return mutate(project, (draft) => {
    const name = head.trim();
    if (name === '') return;
    const defs = draft.commands.filter(
      (def) => def.category === category && def.head.trim() === name,
    );
    draft.commands.push({
      uid: newUid(),
      category,
      head: name,
      branch: nextBranchName(defs),
      params: [],
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

/**
 * 改模块名（主指令）：该模块下所有条目一起改，剧情里用到它的指令文本也一起改。
 *
 * 同类别里已经有同名模块时不动（模块名不能重复）。
 */
export function renameCommandModule(
  project: Project,
  category: '条件' | '指令',
  from: string,
  to: string,
): Project {
  return mutate(project, (draft) => {
    const oldName = from.trim();
    const newName = to.trim();
    if (oldName === '' || newName === '' || oldName === newName) return;
    const taken = draft.commands.some(
      (def) => def.category === category && def.head.trim() === newName,
    );
    if (taken) return;

    for (const def of draft.commands) {
      if (def.category === category && def.head.trim() === oldName) def.head = newName;
    }
    mapCommandTexts(draft, category, (text) => {
      const parsed = parseCommandText(text);
      if (parsed === null || parsed.head !== oldName) return null;
      return formatCommandText(newName, parsed.branch, parsed.params);
    });
  });
}

/** 改分支名：条目本身 + 剧情里用到它的指令一起改（同模块里重名时不动） */
export function renameCommandBranch(project: Project, defUid: string, to: string): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    if (def === undefined) return;
    const oldBranch = def.branch.trim();
    const newBranch = to.trim();
    if (oldBranch === newBranch) return;
    const taken = draft.commands.some(
      (item) =>
        item.category === def.category &&
        item.head.trim() === def.head.trim() &&
        item.uid !== def.uid &&
        item.branch.trim() === newBranch,
    );
    if (taken) return;

    def.branch = newBranch;
    const head = def.head.trim();
    mapCommandTexts(draft, def.category, (text) => {
      const parsed = parseCommandText(text);
      if (parsed === null || parsed.head !== head || parsed.branch !== oldBranch) return null;
      return formatCommandText(parsed.head, newBranch, parsed.params);
    });
  });
}

/* ---------- 指令的参数字典 ---------- */

/** 给某条定义末尾加一个空参数（参数名先给个占位，策划自己改） */
export function addCommandParam(project: Project, defUid: string): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    if (def === undefined) return;
    const taken = new Set(def.params.map((param) => param.name.trim()));
    let n = def.params.length + 1;
    while (taken.has(`参数${n}`)) n += 1;
    def.params.push({
      uid: newUid(),
      name: `参数${n}`,
      source: 'text',
      options: [],
      required: true,
      note: '',
    });
  });
}

export function removeCommandParam(project: Project, defUid: string, paramUid: string): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    if (def === undefined) return;
    def.params = def.params.filter((param) => param.uid !== paramUid);
  });
}

export function updateCommandParam(
  project: Project,
  defUid: string,
  paramUid: string,
  patch: Partial<CommandParamDef>,
): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    const param = def?.params.find((item) => item.uid === paramUid);
    if (param !== undefined) Object.assign(param, patch);
  });
}

/**
 * 改参数名：参数本身 + 剧情里用到它的指令一起改。
 *
 * 参数名就是导出文本里的键（`运算符:+`），所以改名要连带改所有已写好的指令；
 * 同一个条目里已经有同名参数时不动。
 */
export function renameCommandParam(
  project: Project,
  defUid: string,
  paramUid: string,
  name: string,
): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    const param = def?.params.find((item) => item.uid === paramUid);
    if (def === undefined || param === undefined) return;
    const oldName = param.name.trim();
    const newName = name.trim();
    if (newName === '' || oldName === newName) return;
    if (def.params.some((item) => item.uid !== paramUid && item.name.trim() === newName)) return;

    param.name = newName;
    const head = def.head.trim();
    const branch = def.branch.trim();
    mapCommandTexts(draft, def.category, (text) => {
      const parsed = parseCommandText(text);
      if (parsed === null || parsed.head !== head || parsed.branch !== branch) return null;
      if (!parsed.params.some((item) => item.name === oldName)) return null;
      return formatCommandText(
        parsed.head,
        parsed.branch,
        parsed.params.map((item) => ({
          name: item.name === oldName ? newName : item.name,
          value: item.value,
        })),
      );
    });
  });
}

/** 参数顺序就是填表时控件从左到右的顺序，所以挪位子是常用操作 */
export function moveCommandParam(
  project: Project,
  defUid: string,
  paramUid: string,
  delta: number,
): Project {
  return mutate(project, (draft) => {
    const def = draft.commands.find((item) => item.uid === defUid);
    if (def === undefined) return;
    const from = def.params.findIndex((param) => param.uid === paramUid);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= def.params.length) return;
    const [moved] = def.params.splice(from, 1);
    def.params.splice(to, 0, moved);
  });
}

/* ---------- 指令的使用情况 ---------- */

export interface CommandLocation {
  groupUid: string;
  /** 点这条位置时跳过去的那一行 */
  lineUid: string;
  /** 给人看的位置，如「序章 / 开场 · Dia_ch01_001-2 · 选项 A」 */
  label: string;
}

export interface CommandUsage {
  text: string;
  count: number;
  /** 字典里那一条；匹配不上时是 undefined */
  def: CommandDef | undefined;
  /** 连新格式都解析不出来（老格式没迁移成功、或手改坏了） */
  broken: boolean;
  locations: CommandLocation[];
}

/**
 * 汇总某一类（条件 / 指令）在剧情里用到的次数与位置。
 *
 * 指令只出现在「指令」行上；条件出现在选项的出现/可用条件、
 * 以及「跳转到段落」行的可用条件里。
 */
export function collectCommands(project: Project, category: '条件' | '指令'): CommandUsage[] {
  const map = new Map<string, CommandUsage>();

  const push = (text: string, where: CommandLocation): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    let entry = map.get(trimmed);
    if (entry === undefined) {
      const parsed = parseCommandText(trimmed);
      entry = {
        text: trimmed,
        count: 0,
        def:
          parsed === null
            ? undefined
            : findCommandDef(project.commands, category, parsed.head, parsed.branch),
        broken: parsed === null,
        locations: [],
      };
      map.set(trimmed, entry);
    }
    entry.count += 1;
    entry.locations.push(where);
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const groupLabel = `${chapter.title || chapter.id} / ${group.title || group.id}`;
      for (const line of group.lines) {
        const base = { groupUid: group.uid, lineUid: line.uid };
        if (category === '指令') {
          // 「跳转到段落」行的指令是按段落现拼的，不在字典里，也不进使用情况
          if (line.kind === '指令' && line.jumpGroupUid === null) {
            push(line.command, { ...base, label: `${groupLabel} · ${line.readableId}` });
          }
          continue;
        }
        if (line.jumpGroupUid !== null) {
          for (const condition of line.jumpConditions) {
            push(condition, { ...base, label: `${groupLabel} · ${line.readableId}` });
          }
        }
        if (line.kind !== '选项') continue;
        for (let index = 0; index < line.optionIds.length; index += 1) {
          const option = group.options.find((item) => item.uid === line.optionIds[index]);
          if (option === undefined) continue;
          const tag = String.fromCharCode(65 + (index % 26));
          const label = `${groupLabel} · ${option.readableId} · 选项 ${tag}`;
          for (const condition of option.appearConditions) push(condition, { ...base, label });
          for (const condition of option.enableConditions) push(condition, { ...base, label });
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => a.text.localeCompare(b.text, 'zh'));
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

/* ---------- 角色名 / 别名的译文 ---------- */

/**
 * 改「角色名本地化」里的一条：默认名称，或某个别名。
 *
 * 中文与译文都挂在角色表那一行上（默认名称：name / nameEn / nameJa；别名：text / en / ja），
 * 所以这里按 uid 找到是哪一个（角色 uid 或别名 uid），改对应字段。别名 uid 全局唯一。
 */
export function updateNameText(
  project: Project,
  uid: string,
  lang: 'zh' | 'en' | 'ja',
  value: string,
): Project {
  return mutate(project, (draft) => {
    for (const character of draft.characters) {
      if (character.uid === uid) {
        const field = lang === 'zh' ? 'name' : lang === 'en' ? 'nameEn' : 'nameJa';
        Object.assign(character, { [field]: value });
        return;
      }
      const alias = character.aliases.find((row) => row.uid === uid);
      if (alias !== undefined) {
        const field = lang === 'zh' ? 'text' : lang;
        Object.assign(alias, { [field]: value });
        return;
      }
    }
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

/** 改「特殊指令」子表的 Command类 前缀 */
export function updateSpecialCommandClassPrefix(project: Project, prefix: string): Project {
  return mutate(project, (draft) => {
    draft.specialCommandClassPrefix = prefix;
  });
}
