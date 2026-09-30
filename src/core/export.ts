/**
 * 导出：把项目数据渲染成一个 xlsx，内含三张工作表。
 *
 * 现有 Excel 流程是「策划填表 + 表格公式规整」，其中的公式列由本模块接管：
 *
 *   文本ID   = "TXT_" + 对话ID（只有「对话」行有）
 *   指令列表 = 「指令」行写自己那一条；「选项」行写它名下所有选项的结果
 *   选项列表 = 「选项」行把它挂着的选项按顺序列出来
 *
 * 对话表没有跳转列：对话按顺序执行，跳转只由选项决定。
 * 因此「下一对话ID」只出现在选项表里。
 *
 * 与旧流程的差异（已确认）：
 *   - 备注列不导出；空行不导出，分组改由「章节 / 段落」结构表达
 *   - 「指令（换行间隔）」「剧情选项（换行间隔）」两列不导出——它们原本只是
 *     给策划填、再由公式算出「指令列表」「选项列表」的中间产物，软件直接接管
 *   - 文本内容移出对话表，统一进本地化表
 *   - 选项行独立成表，跳转目标随之移入选项表
 *   - 三张表合并进同一个 xlsx，而不是三个 csv 文件
 *   - UI 本地化（TXT_Widget_* 这类界面文案）不单独成表，接在本地化表的
 *     对话 / 选项文本后面一起导出
 */

import ExcelJS from 'exceljs';

import { formatArrayLiteral } from './array-literal';
import {
  ATTRIBUTE_SHEET,
  CHARACTER_SHEET,
  EFFECT_SHEET,
  EVENT_SHEET,
  GAMEPLAY_TAGS_SHEET,
  SKILL_SHEET,
  WEAPON_SHEET,
  buildBattleRows,
} from './battle-export';
import { PLAY_DIALOGUE_HEAD } from './command-build';
import { IMPORT_SETTINGS_SHEET, buildImportSettingRows } from './export-settings';
import {
  characterNameKeyOf,
  displayNameKeyOf,
  firstLineIdOf,
  groupUidOfFirstLine,
  textIdOf,
} from './ids';
import { collectNameEntries } from './localization';
import { characterIdOf, collectRefMaps, translateTarget, type UidToId } from './refs';
import type { Group, Line, Project, StoryOption } from './types';

export const DIALOGUE_SHEET = '对话';
export const OPTION_SHEET = '选项';
export const LOCALE_SHEET = '本地化';
/** 剧情角色表；战斗那边的「GAS角色」是另一张（见 battle-export.ts） */
export const STORY_CHARACTER_SHEET = '角色';

export const DIALOGUE_HEADER: readonly string[] = [
  '',
  '文本类型',
  '角色ID',
  '角色显示名称',
  '强制自动播放下一对话',
  '文本ID',
  '选项列表',
  '指令列表',
  /* 「跳转到段落」行的可用条件（全部满足才跳）；其它行留空 */
  '可用条件列表',
];

export const OPTION_HEADER: readonly string[] = [
  '',
  '选项文本',
  '出现条件列表',
  '可用条件列表',
  '结果列表',
  '下一对话ID',
];

export const LOCALE_HEADER: readonly string[] = ['', '中文', '英文', '日文'];

/**
 * 角色表（剧情那一张）。
 *
 * 第一列是行名（角色 ID，「默认名称」在本地化表里，所以这一格写的是文本 key）；
 * 播放位置直接写中文选项名，Unreal 那边认这三个串。
 */
export const STORY_CHARACTER_HEADER: readonly string[] = ['', '播放位置', '默认名称', '表情差分列表'];

export interface ExportRowSets {
  dialogue: string[][];
  options: string[][];
  locale: string[][];
  characters: string[][];
}

/** uid → 可读 ID。导出时把内部引用翻译成 Unreal 需要的 ID。 */
function buildIdMap(project: Project): UidToId {
  return collectRefMaps(project).byUid;
}

/** 段落 uid → 段落。选项的「跳转到首句」和「跳转到段落」行都要按它现取第一句 */
function buildGroupMap(project: Project): Map<string, Group> {
  const map = new Map<string, Group>();
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) map.set(group.uid, group);
  }
  return map;
}

type RefFn = (uid: string) => string;

/** 生成各张表的行数据，供导出与测试共用 */
export function buildRows(project: Project): ExportRowSets {
  const idOf = buildIdMap(project);
  const groupOf = buildGroupMap(project);
  const ref: RefFn = (uid) => (uid === '' ? '' : idOf.get(uid) ?? '');

  const dialogue: string[][] = [[...DIALOGUE_HEADER]];
  const options: string[][] = [[...OPTION_HEADER]];
  const locale: string[][] = [[...LOCALE_HEADER]];
  const characters: string[][] = [[...STORY_CHARACTER_HEADER]];

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        pushLine(project, line, group, ref, groupOf, idOf, dialogue, locale);

        // 「选项」行的选项紧随该行输出，与现有本地化表的排列习惯一致
        if (line.kind !== '选项') continue;
        for (const optionUid of line.optionIds) {
          const option = group.options.find((o) => o.uid === optionUid);
          if (option === undefined) continue; // 悬空引用交由校验层报告
          pushOption(option, ref, groupOf, idOf, options, locale);
        }
      }
    }
  }

  for (const character of project.characters) {
    // 角色 ID 是这张表的行名，也是本地化 key 的一段；没填的行导出也没法命名，跳过
    const id = character.id.trim();
    if (id === '') continue;
    characters.push([
      id,
      character.playPosition,
      // 默认名称跟对话文本一样进本地化表，这一格写 key
      characterNameKeyOf(id),
      formatArrayLiteral(character.expressions),
    ]);
  }

  // UI 本地化接在对话 / 选项的文本后面，排在同一张本地化表里
  for (const row of project.uiTexts) {
    locale.push([row.key, row.text.zh, row.text.en, row.text.ja]);
  }

  // 角色名与显示名也进本地化表（中文来自角色表 / 对话行，英文日文来自 nameTexts）
  for (const entry of collectNameEntries(project)) {
    locale.push([entry.key, entry.zh, entry.en, entry.ja]);
  }

  return { dialogue, options, locale, characters };
}

function pushLine(
  project: Project,
  line: Line,
  group: Group,
  ref: RefFn,
  groupOf: Map<string, Group>,
  idOf: Map<string, string>,
  dialogue: string[][],
  locale: string[][],
): void {
  const isDialogue = line.kind === '对话';
  // 指令 / 条件里指向各张表的目标存的都是 uid，导出前统一翻成可读 ID
  const translate = (text: string): string => translateTarget(text, idOf);

  dialogue.push([
    line.readableId,
    line.kind,
    // 角色那一格存的是角色 uid，这里翻回角色 ID；找不到对应行就原样写出
    isDialogue ? characterIdOf(project, line.characterUid) : '',
    // 填了「显示名」的行，这一格写文本 key，中文走本地化表（跟「文本ID」列一个套路）
    isDialogue && line.displayName.trim() !== '' ? displayNameKeyOf(line.readableId) : '',
    isDialogue && line.autoAdvance ? 'True' : '',
    isDialogue ? textIdOf(line.readableId) : '',
    formatArrayLiteral(line.kind === '选项' ? line.optionIds.map(ref).filter((id) => id !== '') : []),
    formatArrayLiteral(commandsOf(line, group, groupOf).map(translate)),
    // 可用条件只有「跳转到段落」行有：全部满足才跳
    formatArrayLiteral(
      line.kind === '指令' && line.jumpGroupUid !== null
        ? line.jumpConditions.map(translate)
        : [],
    ),
  ]);

  // 只有「对话」行有文本，其余两种类型不进本地化表
  if (isDialogue) {
    locale.push([textIdOf(line.readableId), line.text.zh, line.text.en, line.text.ja]);
  }
}

/**
 * 一行要写进「指令列表」的内容。
 *
 *   「指令」行     - 就是它自己那一条；「跳转到段落」行则是现拼出来的那一条
 *   「选项」行     - 它名下所有选项的「结果」（已和需求方确认）
 *   「对话」行     - 空
 */
function commandsOf(line: Line, group: Group, groupOf: Map<string, Group>): string[] {
  if (line.kind === '指令') {
    // 「跳转到段落」：指令内容按所选段落当时的第一句现拼，段落重排后自动跟着走
    if (line.jumpGroupUid !== null) {
      const firstId = firstLineIdOfGroup(groupOf, line.jumpGroupUid);
      return firstId === '' ? [] : [`${PLAY_DIALOGUE_HEAD}# ${firstId}`];
    }
    const command = line.command.trim();
    return command === '' ? [] : [command];
  }
  if (line.kind !== '选项') return [];

  const merged: string[] = [];
  for (const optionUid of line.optionIds) {
    const option = group.options.find((o) => o.uid === optionUid);
    if (option === undefined) continue;
    for (const result of option.results) {
      const text = result.trim();
      if (text !== '') merged.push(text);
    }
  }
  return merged;
}

/** 某个段落的第一句对话 ID；段落不存在或还是空段落时返回空串 */
function firstLineIdOfGroup(groupOf: Map<string, Group>, groupUid: string): string {
  const group = groupOf.get(groupUid);
  return group === undefined ? '' : firstLineIdOf(group);
}

function pushOption(
  option: StoryOption,
  ref: RefFn,
  groupOf: Map<string, Group>,
  idOf: Map<string, string>,
  options: string[][],
  locale: string[][],
): void {
  const translate = (text: string): string => translateTarget(text, idOf);

  options.push([
    option.readableId,
    textIdOf(option.readableId),
    // 条件、结果都是文本，原样写出；只有指向各表的目标要把 uid 翻成可读 ID
    formatArrayLiteral(option.appearConditions.map(translate)),
    formatArrayLiteral(option.enableConditions.map(translate)),
    formatArrayLiteral(option.results.map(translate)),
    // 「跳转到首句对话」记的是段落，这里现取该段落当时的第一句
    resolveNext(option.nextId, ref, groupOf),
  ]);

  locale.push([textIdOf(option.readableId), option.text.zh, option.text.en, option.text.ja]);
}

/** 选项的「下一对话ID」：普通跳转按 uid 翻译，跳到首句的按段落现取 */
function resolveNext(value: string, ref: RefFn, groupOf: Map<string, Group>): string {
  const groupUid = groupUidOfFirstLine(value);
  if (groupUid === null) return ref(value);
  return firstLineIdOfGroup(groupOf, groupUid);
}

/** 东亚宽字符按两个半角宽度估算，用于设置列宽 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
      ? 2
      : 1;
  }
  return width;
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: string[][]): void {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  for (const row of rows) sheet.addRow(row);

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF3A4252' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F7' } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;

  const columnCount = rows[0]?.length ?? 0;
  for (let column = 1; column <= columnCount; column += 1) {
    let widest = 8;
    for (const row of rows) {
      const cell = row[column - 1];
      if (cell === undefined) continue;
      for (const part of cell.split('\n')) {
        widest = Math.max(widest, displayWidth(part));
      }
    }
    sheet.getColumn(column).width = Math.min(widest + 2, 56);
  }

  // 数据区一律按文本写，避免 Excel 把 ID 或条件误判成数字/公式
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = '@';
    });
  });
}

/** 一张要写进 xlsx 的子表 */
export interface ExportedSheet {
  name: string;
  rows: string[][];
}

/**
 * 全部子表的内容与顺序。
 *
 * 导出与界面上的「导出预览」都走这一处：预览里看到的就是导出去的东西，
 * 两边不会各写一份、也不会顺序对不上。
 */
export function buildAllSheets(project: Project): ExportedSheet[] {
  const story = buildRows(project);
  const battle = buildBattleRows(project);

  return [
    // 剧情四张表
    { name: DIALOGUE_SHEET, rows: story.dialogue },
    { name: OPTION_SHEET, rows: story.options },
    { name: LOCALE_SHEET, rows: story.locale },
    { name: STORY_CHARACTER_SHEET, rows: story.characters },
    // 战斗模块（GAS）七张表
    { name: GAMEPLAY_TAGS_SHEET, rows: battle.gameplayTags },
    { name: ATTRIBUTE_SHEET, rows: battle.attributes },
    { name: EFFECT_SHEET, rows: battle.effects },
    { name: SKILL_SHEET, rows: battle.skills },
    { name: EVENT_SHEET, rows: battle.events },
    { name: CHARACTER_SHEET, rows: battle.characters },
    { name: WEAPON_SHEET, rows: battle.weapons },
    // 导入设置
    { name: IMPORT_SETTINGS_SHEET, rows: buildImportSettingRows(project) },
  ];
}

/** 生成 xlsx 二进制内容 */
export async function exportWorkbook(project: Project): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'StoryMaker';
  workbook.created = new Date();

  for (const sheet of buildAllSheets(project)) {
    addSheet(workbook, sheet.name, sheet.rows);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/** 供界面显示的行数统计 */
export function countLines(project: Project): { lines: number; options: number } {
  let lines = 0;
  let options = 0;
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      lines += group.lines.length;
      options += group.options.length;
    }
  }
  return { lines, options };
}
