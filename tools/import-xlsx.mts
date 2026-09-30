/**
 * 从 tb-gal.xlsx 导入一次初始数据，生成 StoryMaker 项目 JSON。
 *
 *   pnpm exec vite-node tools/import-xlsx.mts <xlsx路径> [输出json]
 *
 * 导入内容：人物、物品（含好感度变量）、任务、立绘，以及默认指令字典。
 * 地图与 CG 按需求跳过。
 */

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ExcelJS from 'exceljs';

import type { Character, CommandDef, LookupRow, StoryOption } from '../src/core/types';
import { normalizeProject, type LegacyLine } from '../src/core/migrate';
import { defaultCommandDefs } from '../src/state/operations';

/** 不带参数时，在这些位置里自动找 tb-gal.xlsx */
const DEFAULT_XLSX = 'tb-gal.xlsx';
const SEARCH_DIRS = ['testinput', 'reference', '.'];

function findDefaultXlsx(): string {
  for (const dir of SEARCH_DIRS) {
    const full = resolve(process.cwd(), dir, DEFAULT_XLSX);
    if (existsSync(full)) return full;
  }
  throw new Error(`找不到 ${DEFAULT_XLSX}，用法: import-xlsx.mts <xlsx路径> [输出json]`);
}

const xlsxPath = process.argv[2] ?? findDefaultXlsx();
const outPath = resolve(process.cwd(), process.argv[3] ?? 'testinput/初始数据.json');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxPath);

function cellText(cell: ExcelJS.Cell): string {
  const raw = cell.value;
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object' && 'richText' in raw) {
    return (raw as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join('');
  }
  if (typeof raw === 'object' && 'text' in raw) return String((raw as { text: unknown }).text);
  if (typeof raw === 'object' && 'result' in raw) return String((raw as { result: unknown }).result);
  return String(raw);
}

/** 把一张表读成二维数组。keepNewlines 为真时保留单元格内的换行 */
function readSheet(name: string, keepNewlines = false): string[][] {
  const sheet = workbook.getWorksheet(name);
  if (sheet === undefined) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      const raw = cellText(row.getCell(col));
      values.push(keepNewlines ? raw.trim() : raw.replace(/\s+/g, ' ').trim());
    }
    if (values.some((value) => value !== '')) rows.push(values);
  });
  return rows;
}

let uidCounter = 0;
const uid = (): string => `seed-${(uidCounter += 1)}`;

/** 【文本(人物)】里的 文本ID → 中文 */
const nameByTextId = new Map<string, string>();
for (const row of readSheet('文本(人物)')) {
  if (row[0]?.startsWith('TXT_')) nameByTextId.set(row[0], row[1] ?? '');
}

// ---- 人物 ----
const characters: Character[] = [];
for (const row of readSheet('人物')) {
  const id = row[0] ?? '';
  if (!id.startsWith('CHA_')) continue;
  // 第 1 列是姓名对应的本地化 key，用它查中文名
  const name = nameByTextId.get(row[1] ?? '') ?? id.replace('CHA_', '');
  characters.push({
    uid: uid(),
    id,
    name,
    playPosition: '剧情对话框',
    expressions: ['默认', '开心', '生气', '悲伤', '害羞'],
    actions: ['默认'],
  });
}

// ---- 物品（含好感度变量）----
const items: LookupRow[] = [];
for (const row of readSheet('物品')) {
  const id = row[0] ?? '';
  if (!id.startsWith('Item_')) continue; // 跳过【货币】【背包物品】这类分段标题行
  items.push({ uid: uid(), id, name: row[1] ?? '' });
}
for (const row of readSheet('好感度')) {
  const name = row[1] ?? '';
  if (name === '' || row[0] === 'ID') continue;
  items.push({ uid: uid(), id: `Like_${name}`, name: `${name} 好感度` });
}

// ---- 任务 ----
const quests: LookupRow[] = [];
for (const row of readSheet('任务')) {
  const id = row[0] ?? '';
  if (!id.startsWith('Task_')) continue;
  quests.push({ uid: uid(), id, name: row[3] ?? '' });
}

// ---- 立绘 / 图片 ----
const images: LookupRow[] = [];
for (const row of readSheet('立绘')) {
  const id = row[0] ?? '';
  if (id === '' || id === '图片分类' || row[1] === '图片分类') continue;
  images.push({ uid: uid(), id, name: row[2] ?? '' });
}

// ---- 指令字典：默认字典 + 音效分支 ----
const commands: CommandDef[] = defaultCommandDefs();
commands.push({
  uid: uid(),
  category: '指令',
  head: '剧情.音效',
  branch: '',
  target: 'sound',
  attribute: '',
  operator: '',
  value: 'none',
  fixedValues: [],
  note: '播放音效，音效 ID 来自音效表',
});

// ---- 示例剧情 ----
// 对话表的「剧情选项」列写成「选项ID = 跳转目标」，选项文本在【选项(对话)】表里。
const optionSource = new Map<string, string[]>();
for (const row of readSheet('选项(对话)')) {
  const id = row[0] ?? '';
  if (id.startsWith('OPT_')) optionSource.set(id, row);
}

const dialogueRows = readSheet('对话', true).filter((row) =>
  /^P_[A-Za-z0-9_]+-\d+[A-Z]?$/.test(row[0] ?? ''),
);

/** 从「剧情选项」列解析出 [选项ID, 跳转目标可读ID] */
function parseOptionEntries(cell: string): [string, string][] {
  const result: [string, string][] = [];
  for (const entry of cell.split(/\r?\n/)) {
    const match = /^\s*(OPT_[A-Za-z0-9_-]+)\s*=\s*([A-Za-z0-9_-]*)\s*$/.exec(entry);
    if (match !== null) result.push([match[1], match[2]]);
  }
  return result;
}

const lines: LegacyLine[] = [];
const options: StoryOption[] = [];
const optionUidById = new Map<string, string>();

for (const row of dialogueRows) {
  const characterId = row[2] ?? '';
  const entries = parseOptionEntries(row[5] ?? '');
  const optionUids: string[] = [];

  for (const [optionId, targetId] of entries) {
    let optionUid = optionUidById.get(optionId);
    if (optionUid === undefined) {
      const source = optionSource.get(optionId);
      optionUid = uid();
      optionUidById.set(optionId, optionUid);
      options.push({
        uid: optionUid,
        readableId: optionId,
        text: { zh: source?.[4] ?? '', en: source?.[5] ?? '', ja: source?.[6] ?? '' },
        // 先存可读 ID，等所有行都建好后再换成 uid
        nextId: targetId,
        appearConditions: [],
        enableConditions: [],
        results: [],
      });
    }
    optionUids.push(optionUid);
  }

  lines.push({
    uid: uid(),
    readableId: row[0] ?? '',
    // xlsx 没有「文本类型」列，按有没有角色 ID 判断
    kind: characterId === '' ? '其他' : '对话',
    characterId,
    displayName: '',
    text: { zh: row[3] ?? '', en: row[7] ?? '', ja: row[8] ?? '' },
    autoAdvance: false,
    commands: (row[4] ?? '')
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter((part) => part !== ''),
    optionIds: optionUids,
  });
}

// 把跳转目标从可读 ID 换成 uid；换不到的说明指向了对话表以外的行
const lineUidById = new Map(lines.map((line) => [line.readableId, line.uid]));
for (const option of options) {
  option.nextId = lineUidById.get(option.nextId) ?? '';
}

// 按 ID 里的段号切分段落，例如 P_Test_001-3 归入段落 001
const linesByGroup = new Map<string, LegacyLine[]>();
for (const line of lines) {
  const groupId = /^P_[A-Za-z0-9_]+_(\d+)-/.exec(line.readableId)?.[1] ?? '001';
  if (!linesByGroup.has(groupId)) linesByGroup.set(groupId, []);
  linesByGroup.get(groupId)?.push(line);
}

const groups = [...linesByGroup.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([groupId, groupLines]) => ({
    uid: uid(),
    id: groupId,
    title: `段落 ${groupId}`,
    lines: groupLines,
    options: options.filter((option) =>
      groupLines.some((line) => line.optionIds.includes(option.uid)),
    ),
  }));

// xlsx 里指令挂在对话行上，是老结构；交给迁移拆成「指令」/「选项」独立的行
const normalized = normalizeProject({
  version: 1,
  name: 'B.S.Game',
  characters,
  items,
  quests,
  images,
  sounds: [],
  commands,
  chapters: [{ uid: uid(), id: 'ch01', title: '序章', groups }],
  variables: [],
  uiTexts: [],
  nameTexts: [],
});
if (normalized === null) throw new Error('导入数据构建失败');

writeFileSync(outPath, JSON.stringify(normalized.project, null, 2), 'utf8');

console.log(`已生成 ${outPath}`);
console.log(`  角色 ${characters.length} 个`);
console.log(`  物品 ${items.length} 条（含好感度变量）`);
console.log(`  任务 ${quests.length} 条`);
console.log(`  立绘 ${images.length} 条`);
console.log(`  指令定义 ${commands.length} 条`);
console.log(`  剧情 ${lines.length} 行，分 ${groups.length} 个段落，选项 ${options.length} 个`);
console.log(`  迁移：${normalized.changes.length} 个对话 ID 因插入指令 / 选项行而重排`);
