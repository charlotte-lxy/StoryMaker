/**
 * 用工作目录里的真实样例做端到端验证。
 *
 * 这里不构造假数据，而是把策划现有的 TB_BSGame-脚本.csv 读进来，
 * 还原成老结构（指令挂在对话行上、选项挂在 optionIds 上），
 * 交给迁移拆成「对话 / 选项 / 指令」三种行，再走一遍导出，逐列比对关键结果。
 * 目的是证明软件产出的是目标格式，而不是「我以为的目标格式」。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseArrayLiteral } from './array-literal';
import { parseCommandText } from './command-build';
import { parseCsv } from './csv';
import { DIALOGUE_HEADER, buildRows } from './export';
import { normalizeProject, type LegacyLine } from './migrate';
import type { Project, StoryOption } from './types';

/**
 * 老写法 `主指令# 目标.属性 运算符 结果` 里的目标。
 *
 * 只用来核对「迁移后目标没丢」：按第一个 `.` / 运算符切开，取前面那一截；
 * 带 `-` 的 ID 会被切短，所以比对时用「包含」而不是「相等」。
 */
function legacyTargetOf(text: string): string {
  const hash = text.indexOf('#');
  if (hash < 0) return '';
  const rest = text.slice(hash + 1).trim();
  const cut = rest.split(/\.|\s*(?:>=|<=|==|!=|>|<|\+|-|=)/)[0].trim();
  return cut === '移除' ? '' : cut;
}

const SCRIPT_FILE = 'TB_BSGame-脚本.csv';
const LOCALE_FILE = 'TB_BSGame_本地化-脚本.csv';

/** 样例可能被放在这几个位置，逐个找 */
const SEARCH_DIRS = ['testinput', 'reference', '.'];

function findSample(file: string): string | null {
  for (const dir of SEARCH_DIRS) {
    const full = resolve(process.cwd(), dir, file);
    if (existsSync(full)) return full;
  }
  return null;
}

function readTable(file: string): string[][] {
  const found = findSample(file);
  if (found === null) throw new Error(`找不到样例文件：${file}`);
  return parseCsv(readFileSync(found, 'utf8'));
}

const hasSamples = findSample(SCRIPT_FILE) !== null && findSample(LOCALE_FILE) !== null;

interface Sample {
  scriptRows: string[][];
  project: Project;
}

function buildSample(): Sample {
  const scriptRows = readTable(SCRIPT_FILE)
    .slice(1)
    .filter((row) => row.join('').trim() !== '');

  const idToUid = new Map<string, string>();
  scriptRows.forEach((row, index) => idToUid.set(row[0].trim(), `u${index}`));

  const lines: LegacyLine[] = [];
  const options: StoryOption[] = [];

  scriptRows.forEach((row, index) => {
    const id = row[0].trim();
    const uid = `u${index}`;
    const kind = row[2].trim();
    const text = { zh: row[5], en: '', ja: '' };
    const commands = row[7].split('\n').map((s) => s.trim()).filter((s) => s !== '');
    const nextId = row[9].trim() === '' ? '' : idToUid.get(row[9].trim()) ?? 'u-MISSING';

    if (kind === '选项') {
      options.push({
        uid,
        readableId: id,
        text,
        nextId,
        appearConditions: [],
        enableConditions: [],
      });
      return;
    }

    lines.push({
      uid,
      readableId: id,
      kind: kind === '其他' ? '其他' : '对话',
      characterId: row[3].trim(),
      displayName: row[4].trim(),
      text,
      autoAdvance: row[6].trim() === 'True',
      commands,
      optionIds: row[8]
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((optionId) => idToUid.get(optionId) ?? 'u-MISSING'),
    });
  });

  const normalized = normalizeProject({
    version: 1,
    name: '样例',
    characters: [],
    sounds: [],
    commands: [],
    items: [],
    quests: [],
    images: [],
    imageCategories: [],
    soundCategories: [],
    variables: [],
    chapters: [
      {
        uid: 'c1',
        id: 'ch01',
        title: '序章',
        // 样例中 ID 形如 ch01_001-x，全部归入同一个段落即可
        groups: [{ uid: 'g1', id: '001', title: '样例段落', lines, options }],
      },
    ],
  });
  if (normalized === null) throw new Error('样例迁移失败');

  return { scriptRows, project: normalized.project };
}

describe.skipIf(!hasSamples)('真实样例端到端验证', () => {
  const sample = buildSample();
  const tables = buildRows(sample.project);
  const dialogue = tables.dialogue;
  const options = tables.options;
  const locale = tables.locale;

  /** 老数据里非选项的行（对话 / 其他） */
  const legacyLines = sample.scriptRows.filter((row) => row[2].trim() !== '选项');
  /** 老数据里的选项行 */
  const legacyOptions = sample.scriptRows.filter((row) => row[2].trim() === '选项');
  /** 老结构里「其他」行有文本的会被保留成「对话」行 */
  const expectedTalkTexts = legacyLines
    .filter((row) => row[2].trim() === '对话' || row[5].trim() !== '')
    .map((row) => row[5]);

  it('对话表里只有「对话 / 选项 / 指令」三种类型', () => {
    const kinds = new Set(dialogue.slice(1).map((row) => row[1]));
    // 按 Unicode 排序：对话 < 指令 < 选项
    expect([...kinds].sort()).toEqual(['对话', '指令', '选项']);
    for (const row of dialogue) expect(row).toHaveLength(DIALOGUE_HEADER.length);
  });

  it('老数据的台词一句不丢，且顺序不变', () => {
    const actual = dialogue
      .slice(1)
      .filter((row) => row[1] === '对话')
      .map((row) => row[0]);
    expect(actual).toHaveLength(expectedTalkTexts.length);

    // 台词不进对话表，逐条到本地化表里核对
    const zhByKey = new Map(locale.slice(1).map((row) => [row[0], row[1]]));
    for (const row of dialogue.slice(1)) {
      if (row[1] !== '对话') continue;
      expect(zhByKey.has(row[5])).toBe(true);
    }
    const texts = dialogue
      .slice(1)
      .filter((row) => row[1] === '对话')
      .map((row) => zhByKey.get(row[5]));
    expect(texts).toEqual(expectedTalkTexts);
  });

  it('老数据的指令一条不丢，顺序不变（含一行的多条指令）', () => {
    const expected = legacyLines
      .flatMap((row) => ((row[12] ?? '').length > 0 ? parseArrayLiteral(row[12]) : []))
      .filter((text) => text !== '');
    const actual = dialogue
      .slice(1)
      .filter((row) => row[1] === '指令')
      .map((row) => row[7])
      .filter((text) => text !== '');

    // 条数与顺序都对得上，而且每条都改成了新格式
    expect(actual).toHaveLength(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      expect(parseCommandText(actual[index]), actual[index]).not.toBeNull();
      // 老写法里的目标原样出现在参数值里（「移除」那种本来就没有目标）
      const target = legacyTargetOf(expected[index]);
      if (target !== '') expect(actual[index]).toContain(target);
    }
  });

  it('文本ID 只在「对话」行上填写', () => {
    for (const row of dialogue.slice(1)) {
      if (row[1] === '对话') {
        expect(row[5]).toBe(`TXT_${row[0]}`);
      } else {
        expect(row[5]).toBe('');
        expect(row[2]).toBe(''); // 角色列也留空
      }
    }
  });

  it('选项 ID 是所属「选项」行的 ID 加字母后缀', () => {
    const optionRows = dialogue.slice(1).filter((row) => row[1] === '选项');
    expect(optionRows.length).toBeGreaterThan(0);
    for (const row of optionRows) {
      const ids = parseArrayLiteral(row[6]);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toMatch(/^Dia_ch01_001-\d+[A-Z]+$/);
    }
  });

  it('选项表覆盖样例中的所有选项行，跳转目标指向导出结果里真实存在的行', () => {
    expect(options.slice(1)).toHaveLength(legacyOptions.length);

    const knownIds = new Set([
      ...dialogue.slice(1).map((row) => row[0]),
      ...options.slice(1).map((row) => row[0]),
    ]);
    for (const row of options.slice(1)) {
      expect(row[1]).toBe(`TXT_${row[0]}`);
      expect(row[4]).not.toBe('');
      expect(knownIds.has(row[4])).toBe(true);
    }
  });

  it('本地化表覆盖所有「对话」行与选项，写进对话表的名称 key 也都在表里', () => {
    const keys = locale.slice(1).map((row) => row[0]);
    expect(new Set(keys).size).toBe(keys.length);

    const talkRows = dialogue.slice(1).filter((row) => row[1] === '对话').length;
    expect(keys.length).toBeGreaterThanOrEqual(talkRows + options.slice(1).length);

    // 显示名那一格写的是角色表里的名称 key（同一角色多行共用一条），按「表里有没有」核对
    const nameKeys = dialogue
      .slice(1)
      .map((row) => row[3])
      .filter((key) => key !== '');
    for (const key of nameKeys) expect(keys).toContain(key);
  });

  it('对话表不含任何跳转列，跳转只由选项表承担', () => {
    expect(DIALOGUE_HEADER).not.toContain('下一对话ID');
    expect(DIALOGUE_HEADER).not.toContain('下一对话ID（默认为ID尾号+1）');
  });
});
