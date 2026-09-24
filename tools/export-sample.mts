/**
 * 用工作目录里的真实样例生成一份 xlsx，方便直接用 Excel 打开核对导出格式。
 *
 *   pnpm exec vite-node tools/export-sample.mts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseCsv } from '../src/core/csv';
import { exportWorkbook } from '../src/core/export';
import { normalizeProject, type LegacyLine } from '../src/core/migrate';
import type { StoryOption } from '../src/core/types';

const root = process.cwd();

/** 样例可能被放在这几个位置，逐个找（和导入脚本、样例测试保持一致） */
const SEARCH_DIRS = ['testinput', 'reference', '.'];

function readTable(file: string): string[][] {
  for (const dir of SEARCH_DIRS) {
    const full = resolve(root, dir, file);
    if (!existsSync(full)) continue;
    return parseCsv(readFileSync(full, 'utf8'))
      .slice(1)
      .filter((row) => row.join('').trim() !== '');
  }
  throw new Error(`找不到样例文件：${file}（找过 ${SEARCH_DIRS.join(' / ')}）`);
}

const scriptRows = readTable('TB_BSGame-脚本.csv');
const localeRows = readTable('TB_BSGame_本地化-脚本.csv');

const idToUid = new Map<string, string>();
scriptRows.forEach((row, index) => idToUid.set(row[0].trim(), `u${index}`));

const lines: LegacyLine[] = [];
const options: StoryOption[] = [];

scriptRows.forEach((row, index) => {
  const id = row[0].trim();
  const uid = `u${index}`;
  const kind = row[2].trim();
  const nextId = row[9].trim() === '' ? '' : idToUid.get(row[9].trim()) ?? '';
  const commands = row[7]
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (kind === '选项') {
    options.push({
      uid,
      readableId: id,
      text: { zh: row[5], en: '', ja: '' },
      nextId,
      appearConditions: [],
      enableConditions: [],
      results: [],
    });
    return;
  }

  lines.push({
    uid,
    readableId: id,
    kind: kind === '其他' ? '其他' : '对话',
    characterId: row[3].trim(),
    displayName: row[4].trim(),
    text: { zh: row[5], en: '', ja: '' },
    autoAdvance: row[6].trim() === 'True',
    commands,
    optionIds: row[8]
      .split('\n')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((optionId) => idToUid.get(optionId) ?? ''),
  });
});

// 把本地化表里的英文、日文补回去
for (const row of localeRows) {
  const key = row[0].trim();
  const id = key.startsWith('TXT_') ? key.slice(4) : key;
  const uid = idToUid.get(id);
  const target = lines.find((l) => l.uid === uid) ?? options.find((o) => o.uid === uid);
  if (target !== undefined) {
    target.text.en = row[2];
    target.text.ja = row[3];
  }
}

const legacy = {
  version: 1 as const,
  name: '样例导出',
  characters: [
    { uid: 'ch1', id: 'CHA_伊芙', name: '伊芙', expressions: [], actions: [] },
    { uid: 'ch2', id: 'CHA_Q版伊芙', name: 'Q版伊芙', expressions: [], actions: [] },
    { uid: 'ch3', id: 'CHA_主角', name: '主角', expressions: [], actions: [] },
    { uid: 'ch4', id: 'CHA_指挥官', name: '指挥官', expressions: [], actions: [] },
  ],
  items: [],
  quests: [],
  images: [],
  sounds: [],
  commands: [],
  chapters: [
    {
      uid: 'c1',
      id: 'ch01',
      title: '序章',
      groups: [{ uid: 'g1', id: '001', title: '样例段落', lines, options }],
    },
  ],
  variables: [],
};

// 现有 CSV 是老结构（指令挂在对话行上），交给迁移拆成独立的行
const normalized = normalizeProject(legacy);
if (normalized === null) throw new Error('样例数据构建失败');

const buffer = await exportWorkbook(normalized.project);
writeFileSync(resolve(root, '样例导出.xlsx'), Buffer.from(buffer));
console.log(
  `已生成 样例导出.xlsx：${lines.length} 行老数据 → ${normalized.changes.length} 个 ID 变化` +
    `（迁移成「对话 / 选项 / 指令」三种行）`,
);
