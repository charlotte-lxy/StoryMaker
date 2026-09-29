import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { createEmptyBattle } from './battle';

import { escapeCsvField, parseCsv, toCsv, withBom, withoutBom } from './csv';
import { formatArrayLiteral, parseArrayLiteral } from './array-literal';
import { firstLineRef, makeLineId, makeOptionId, renumberGroup, textIdOf } from './ids';
import { DIALOGUE_HEADER, buildRows, countLines, exportWorkbook, type ExportRowSets } from './export';
import type { Group, Line, Project, StoryOption } from './types';

function makeLine(uid: string, readableId: string, over: Partial<Line> = {}): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterId: '',
    displayName: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    jumpGroupUid: null,
    jumpConditions: [],
    command: '',
    optionIds: [],
    note: '',
    ...over,
  };
}

function makeOption(uid: string, readableId: string, over: Partial<StoryOption> = {}): StoryOption {
  return {
    uid,
    readableId,
    text: { zh: '', en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
    results: [],
    ...over,
  };
}

describe('CSV 序列化', () => {
  it('只在必要时加引号', () => {
    expect(escapeCsvField('普通文本')).toBe('普通文本');
    expect(escapeCsvField('')).toBe('');
    expect(escapeCsvField('含,逗号')).toBe('"含,逗号"');
  });

  it('复现样例中的嵌套引号转义', () => {
    // 样例原文： ("剧情.特殊# SP_ch01_001")
    // 在 CSV 中写成： "(""剧情.特殊# SP_ch01_001"")"
    expect(escapeCsvField('("剧情.特殊# SP_ch01_001")')).toBe(
      '"(""剧情.特殊# SP_ch01_001"")"',
    );
  });

  it('多行字段被引号包裹', () => {
    const commands = '剧情.人物# CHA_Q版伊芙.进入 = 1\n剧情.人物# CHA_Q版伊芙.差分 = 挥手';
    expect(escapeCsvField(commands)).toBe(`"${commands}"`);
  });

  it('往返解析一致', () => {
    const rows = [
      ['a', 'b,c', '含"引号"', '多\n行'],
      ['', 'x', '', ''],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('BOM 可加可去', () => {
    expect(withBom('abc')).toBe('\uFEFFabc');
    expect(withoutBom('\uFEFFabc')).toBe('abc');
  });
});

describe('数组字面量', () => {
  it('复现样例：单条指令', () => {
    expect(formatArrayLiteral(['剧情.特殊# SP_ch01_001'])).toBe('("剧情.特殊# SP_ch01_001")');
  });

  it('复现样例：同一行的两条指令', () => {
    // 样例 Dia_ch01_001-16 的「指令列表」列原文
    expect(
      formatArrayLiteral([
        '剧情.人物# CHA_Q版伊芙.进入 = 1',
        '剧情.人物# CHA_Q版伊芙.差分 = 挥手',
      ]),
    ).toBe(
      '("剧情.人物# CHA_Q版伊芙.进入 = 1","剧情.人物# CHA_Q版伊芙.差分 = 挥手")',
    );
  });

  it('复现样例：两个选项', () => {
    expect(formatArrayLiteral(['Dia_ch01_001-16A', 'Dia_ch01_001-16B'])).toBe(
      '("Dia_ch01_001-16A","Dia_ch01_001-16B")',
    );
  });

  it('空列表输出空串，而不是 ()', () => {
    // 样例中「指令」列为空的行，其「指令列表」列也是空的
    expect(formatArrayLiteral([])).toBe('');
  });

  it('往返解析一致', () => {
    expect(parseArrayLiteral('("a","b")')).toEqual(['a', 'b']);
    expect(parseArrayLiteral('')).toEqual([]);
    expect(parseArrayLiteral('()')).toEqual([]);
  });
});

describe('ID 生成', () => {
  it('生成样例形式的 ID', () => {
    expect(makeLineId('ch01', '001', 1)).toBe('Dia_ch01_001-1');
    expect(makeLineId('ch01', '001', 16)).toBe('Dia_ch01_001-16');
    expect(makeOptionId('Dia_ch01_001-16', 0)).toBe('Dia_ch01_001-16A');
    expect(makeOptionId('Dia_ch01_001-16', 1)).toBe('Dia_ch01_001-16B');
    expect(makeOptionId('Dia_ch01_001-16', 26)).toBe('Dia_ch01_001-16AA');
    expect(textIdOf('Dia_ch01_001-1')).toBe('TXT_Dia_ch01_001-1');
  });
});

describe('重排 ID', () => {
  function makeGroup(): Group {
    const line1 = makeLine('u1', 'Dia_ch01_001-1');
    // 「选项」行挂着两个选项
    const line2 = makeLine('u2', 'Dia_ch01_001-2', {
      kind: '选项',
      optionIds: ['o-a', 'o-b'],
    });
    const line3 = makeLine('u3', 'Dia_ch01_001-3');
    return {
      uid: 'g1',
      id: '001',
      title: '序章',
      note: '',
      lines: [line1, line2, line3],
      options: [
        makeOption('o-a', 'Dia_ch01_001-2A', { nextId: 'u3' }),
        makeOption('o-b', 'Dia_ch01_001-2B', { nextId: 'u3' }),
      ],
    };
  }

  it('在开头插入一行后，后续 ID 位移但引用不断', () => {
    const group = makeGroup();
    group.lines.unshift(makeLine('u0', 'Dia_ch01_001-999'));

    const changes = renumberGroup(group, 'ch01');

    expect(group.lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
      'Dia_ch01_001-4',
    ]);
    // 选项跟随宿主行的序号
    expect(group.options.map((o) => o.readableId)).toEqual([
      'Dia_ch01_001-3A',
      'Dia_ch01_001-3B',
    ]);
    // 引用走 uid，因此选项的跳转仍然指向原来那一行（现在是第 4 行）
    const optionA = group.options[0];
    expect(optionA.nextId).toBe('u3');
    const target = group.lines.find((l) => l.uid === optionA.nextId);
    expect(target?.readableId).toBe('Dia_ch01_001-4');
    // 对照表可用于同步本地化表
    expect(changes).toContainEqual({
      uid: 'u2',
      oldId: 'Dia_ch01_001-2',
      newId: 'Dia_ch01_001-3',
    });
  });

  it('无变化时不产生对照项', () => {
    const group = makeGroup();
    expect(renumberGroup(group, 'ch01')).toEqual([]);
  });
});

describe('导出：跳到首句与跳到段落', () => {
  /** 段落 001：一句台词 + 一个「选项」行 + 一条「跳转到段落」；段落 002 是目标 */
  function makeJumpProject(): Project {
    const talk = makeLine('u1', 'Dia_ch01_001-1', { text: { zh: '开场', en: '', ja: '' } });
    const chose = makeLine('u2', 'Dia_ch01_001-2', { kind: '选项', optionIds: ['o-a'] });
    const jump = makeLine('u3', 'Dia_ch01_001-3', { kind: '指令', jumpGroupUid: 'g2' });
    // 选项的跳转目标记的是"段落 002 的第一句"，不是具体某一行
    const optA = makeOption('o-a', 'Dia_ch01_001-2A', { nextId: firstLineRef('g2') });

    return {
      version: 1,
      name: '跳转测试',
      characters: [],
      sounds: [],
      commands: [],
      items: [],
      quests: [],
      images: [],
      variables: [],
      uiTexts: [],
      battle: createEmptyBattle(),
      exportSettings: [],
      chapters: [
        {
          uid: 'c1',
          id: 'ch01',
          title: '序章',
          groups: [
            { uid: 'g1', id: '001', title: '开场', note: '', lines: [talk, chose, jump], options: [optA] },
            {
              uid: 'g2',
              id: '002',
              title: '码头',
              note: '',
              lines: [
                makeLine('u4', 'Dia_ch01_002-1', { text: { zh: 'A', en: '', ja: '' } }),
                makeLine('u5', 'Dia_ch01_002-2', { text: { zh: 'B', en: '', ja: '' } }),
              ],
              options: [],
            },
          ],
        },
      ],
    };
  }

  const optionRow = (project: Project): string[] => {
    const row = buildRows(project).options.slice(1).find((item) => item[0] === 'Dia_ch01_001-2A');
    if (row === undefined) throw new Error('选项表里没有这一条');
    return row;
  };

  it('选项选了「跳转到首句对话」：导出的下一对话ID 是目标段落当时的第一句', () => {
    expect(optionRow(makeJumpProject())[5]).toBe('Dia_ch01_002-1');
  });

  it('目标段落里插了一行之后，不用改选项，导出的首句跟着变', () => {
    const project = makeJumpProject();
    const group = project.chapters[0].groups[1];
    // 和界面上插入一行一样：插进去再重排
    group.lines.unshift(makeLine('u6', 'Dia_ch01_002-3', { text: { zh: '新插的第一句', en: '', ja: '' } }));
    renumberGroup(group, 'ch01');

    expect(optionRow(project)[5]).toBe('Dia_ch01_002-1');
    expect(project.chapters[0].groups[1].lines[0].uid).toBe('u6');
  });

  it('「跳转到段落」行导出成「剧情.播放对话# 该段落第一句的对话ID」', () => {
    const rows = buildRows(makeJumpProject());
    const row = rows.dialogue.slice(1).find((item) => item[0] === 'Dia_ch01_001-3');
    expect(row?.[1]).toBe('指令'); // 文本类型还是「指令」
    expect(row?.[7]).toBe('("剧情.播放对话# Dia_ch01_002-1")');
  });

  it('「跳转到段落」的可用条件写进新增的「可用条件列表」列，其它行留空', () => {
    const project = makeJumpProject();
    project.chapters[0].groups[0].lines[2].jumpConditions = [
      '背包#Item_Coin>=10',
      '任务# Task_Test_01=1',
    ];
    const rows = buildRows(project);
    const header = rows.dialogue[0];
    expect(header[header.length - 1]).toBe('可用条件列表');

    const jumpRow = rows.dialogue.slice(1).find((item) => item[0] === 'Dia_ch01_001-3');
    expect(jumpRow?.[8]).toBe('("背包#Item_Coin>=10","任务# Task_Test_01=1")');
    // 指令内容照旧只有那条跳转指令，条件不混进去
    expect(jumpRow?.[7]).toBe('("剧情.播放对话# Dia_ch01_002-1")');

    // 其它行（对话 / 选项）这一列是空的
    for (const id of ['Dia_ch01_001-1', 'Dia_ch01_001-2', 'Dia_ch01_002-1']) {
      expect(rows.dialogue.slice(1).find((item) => item[0] === id)?.[8]).toBe('');
    }
  });

  it('可用条件里指向对话行的目标同样翻成对话 ID', () => {
    const project = makeJumpProject();
    project.chapters[0].groups[0].lines[2].jumpConditions = ['剧情# u1 = 1'];
    const rows = buildRows(project);
    const jumpRow = rows.dialogue.slice(1).find((item) => item[0] === 'Dia_ch01_001-3');
    expect(jumpRow?.[8]).toBe('("剧情# Dia_ch01_001-1 = 1")');
  });

  it('还没选段落、或指到的段落不在了：这一格留空，不写半截指令', () => {
    const unset = makeJumpProject();
    unset.chapters[0].groups[0].lines[2].jumpGroupUid = '';
    expect(
      buildRows(unset).dialogue.slice(1).find((item) => item[0] === 'Dia_ch01_001-3')?.[7],
    ).toBe('');

    const lost = makeJumpProject();
    lost.chapters[0].groups[0].lines[2].jumpGroupUid = '已经删掉的段落';
    expect(
      buildRows(lost).dialogue.slice(1).find((item) => item[0] === 'Dia_ch01_001-3')?.[7],
    ).toBe('');
  });
});

describe('导出：指令里指向对话行的目标翻译成对话 ID', () => {
  /** 一条真正的 uid：uid 里带 `-`，解析指令时会踩到运算符 */
  const LINE_UID = '8f3c1b2a-1234-4abc-9def-0123456789ab';
  /** 段落 001：一条指向对话行的指令 + 一个选项行；段落 002 是被指向的那一句 */
  function makeProject(): Project {
    return {
      version: 1,
      name: '指令目标翻译',
      characters: [],
      sounds: [],
      commands: [],
      items: [],
      quests: [],
      images: [],
      variables: [],
      uiTexts: [],
      battle: createEmptyBattle(),
      exportSettings: [],
      chapters: [
        {
          uid: 'c1',
          id: 'ch01',
          title: '序章',
          groups: [
            {
              uid: 'g1',
              id: '001',
              title: '开场',
              note: '',
              lines: [
                makeLine('u1', 'Dia_ch01_001-1', {
                  kind: '指令',
                  command: `剧情.播放对话# ${LINE_UID}`,
                }),
                // 手写的指令：里面没有 uid，导出要原样保留（连空格也不动）
                makeLine('u2', 'Dia_ch01_001-2', {
                  kind: '指令',
                  command: '背包# Item_Coin >= 10',
                }),
                makeLine('u3', 'Dia_ch01_001-3', { kind: '选项', optionIds: ['o-a'] }),
              ],
              options: [
                makeOption('o-a', 'Dia_ch01_001-3A', {
                  nextId: LINE_UID,
                  appearConditions: [`剧情# ${LINE_UID} = 1`],
                  enableConditions: [`背包#Item_Coin>=10`],
                  results: [`剧情.播放对话# ${LINE_UID}`, '任务.接取# Task_Test_01'],
                }),
              ],
            },
            {
              uid: 'g2',
              id: '002',
              title: '码头',
              note: '',
              lines: [
                makeLine(LINE_UID, 'Dia_ch01_002-1', { text: { zh: '码头', en: '', ja: '' } }),
              ],
              options: [],
            },
          ],
        },
      ],
    };
  }

  const commandCell = (rows: ExportRowSets, id: string): string =>
    rows.dialogue.slice(1).find((row) => row[0] === id)?.[7] ?? '';

  it('「剧情.播放对话# <uid>」导出成对话 ID（uid 里的 - 不会被当成运算符）', () => {
    expect(commandCell(buildRows(makeProject()), 'Dia_ch01_001-1')).toBe(
      '("剧情.播放对话# Dia_ch01_002-1")',
    );
  });

  it('选项的条件与结果里指向对话行的目标同样翻成对话 ID', () => {
    const row = buildRows(makeProject()).options.slice(1).find((item) => item[0] === 'Dia_ch01_001-3A');
    expect(row?.[2]).toBe('("剧情# Dia_ch01_002-1 = 1")');
    // 不是对话行的目标不动：物品 ID 原样保留
    expect(row?.[3]).toBe('("背包#Item_Coin>=10")');
    expect(row?.[4]).toBe('("剧情.播放对话# Dia_ch01_002-1","任务.接取# Task_Test_01")');
  });

  it('没有 uid 的手写指令原样输出，一个字符都不改', () => {
    expect(commandCell(buildRows(makeProject()), 'Dia_ch01_001-2')).toBe('("背包# Item_Coin >= 10")');
  });

  it('引用已经被删掉时（uid 对不上了）保持原样，不把文本改坏', () => {
    const project = makeProject();
    project.chapters[0].groups[0].lines[0].command = '剧情.播放对话# 某个不存在的-uid-0000';
    expect(commandCell(buildRows(project), 'Dia_ch01_001-1')).toBe(
      '("剧情.播放对话# 某个不存在的-uid-0000")',
    );
  });
});

describe('导出三张表', () => {
  function makeProject(): Project {
    const talk = makeLine('u1', 'Dia_ch01_001-1', {
      kind: '对话',
      characterId: 'CHA_Q版伊芙',
      displayName: 'Q版伊芙',
      text: { zh: '你好', en: 'Hello', ja: 'こんにちは' },
    });
    const optionLine = makeLine('u2', 'Dia_ch01_001-2', {
      kind: '选项',
      optionIds: ['o-a', 'o-b'],
    });
    const commandLine = makeLine('u3', 'Dia_ch01_001-3', {
      kind: '指令',
      command: '剧情.特殊# SP_ch01_001',
    });
    const branchA = makeLine('u4', 'Dia_ch01_002-1', {
      text: { zh: '路线A', en: 'Route A', ja: 'ルートA' },
    });
    const branchB = makeLine('u5', 'Dia_ch01_003-1', {
      text: { zh: '路线B', en: 'Route B', ja: 'ルートB' },
    });
    const optA = makeOption('o-a', 'Dia_ch01_001-2A', {
      text: { zh: '这地方到底是哪？', en: 'Where is this?', ja: 'ここはどこ？' },
      nextId: 'u4',
      // 条件与结果都是文本，只是可选范围不同
      appearConditions: ['背包#Item_Coin>0'],
      enableConditions: ['背包#Item_Coin>=10'],
      results: ['背包#Item_Coin-10'],
    });
    const optB = makeOption('o-b', 'Dia_ch01_001-2B', {
      nextId: 'u5',
      results: ['任务.接取# Task_Test_01'],
    });

    return {
      version: 1,
      name: '测试项目',
      characters: [],
      sounds: [],
      commands: [],
      items: [],
      quests: [],
      images: [],
      variables: [],
      uiTexts: [],
      battle: createEmptyBattle(),
      exportSettings: [],
      chapters: [
        {
          uid: 'c1',
          id: 'ch01',
          title: '序章',
          groups: [
            {
              uid: 'g1',
              id: '001',
              title: '开场',
              note: '',
              lines: [talk, optionLine, commandLine, branchA, branchB],
              options: [optA, optB],
            },
          ],
        },
      ],
    };
  }

  const project = makeProject();
  const rows = buildRows(project);
  const byId = (id: string): string[] => {
    const row = rows.dialogue.slice(1).find((item) => item[0] === id);
    if (row === undefined) throw new Error(`对话表里没有 ${id}`);
    return row;
  };

  it('对话表表头不变，三种类型的行都写进对话表', () => {
    expect(rows.dialogue[0]).toEqual([...DIALOGUE_HEADER]);
    expect(rows.dialogue).toHaveLength(6); // 表头 + 5 行
    expect(rows.dialogue.slice(1).map((row) => row[1])).toEqual([
      '对话',
      '选项',
      '指令',
      '对话',
      '对话',
    ]);
    for (const row of rows.dialogue) expect(row).toHaveLength(9);
  });

  it('「对话」行填角色与文本ID，两个列表都留空', () => {
    const row = byId('Dia_ch01_001-1');
    expect(row[2]).toBe('CHA_Q版伊芙'); // 角色ID
    expect(row[3]).toBe('Q版伊芙'); // 显示名
    expect(row[5]).toBe('TXT_Dia_ch01_001-1'); // 文本ID
    expect(row[6]).toBe(''); // 选项列表
    expect(row[7]).toBe(''); // 指令列表
  });

  it('「选项」行填选项列表，指令列表汇总名下选项的结果', () => {
    const row = byId('Dia_ch01_001-2');
    expect(row[2]).toBe('');
    expect(row[5]).toBe(''); // 选项行本身没有文本
    expect(row[6]).toBe('("Dia_ch01_001-2A","Dia_ch01_001-2B")');
    expect(row[7]).toBe('("背包#Item_Coin-10","任务.接取# Task_Test_01")');
  });

  it('「指令」行只填指令列表', () => {
    const row = byId('Dia_ch01_001-3');
    expect(row[5]).toBe('');
    expect(row[6]).toBe('');
    expect(row[7]).toBe('("剧情.特殊# SP_ch01_001")');
  });

  it('「对话」行写不填强制自动播放时留空', () => {
    expect(byId('Dia_ch01_001-1')[4]).toBe('');
    expect(byId('Dia_ch01_002-1')[4]).toBe('');
  });

  it('对话表没有跳转列，跳转只由选项承担', () => {
    expect(rows.dialogue[0]).not.toContain('下一对话ID');
    expect(rows.dialogue[0]).not.toContain('下一对话ID（默认为ID尾号+1）');
  });

  it('不再导出「指令（换行间隔）」与「剧情选项（换行间隔）」这两个中间列', () => {
    expect(rows.dialogue[0]).not.toContain('指令（换行间隔）');
    expect(rows.dialogue[0]).not.toContain('剧情选项（换行间隔）');
  });

  it('对话表不含文本内容，文本只在本地化表', () => {
    const flat = rows.dialogue.flat();
    expect(flat).not.toContain('你好');
    expect(rows.locale.flat()).toContain('你好');
  });

  it('选项表带条件与跳转目标，文本列是本地化 key', () => {
    expect(rows.options).toHaveLength(3); // 表头 + 2 个选项
    const optA = rows.options[1];
    expect(optA[0]).toBe('Dia_ch01_001-2A');
    expect(optA[1]).toBe('TXT_Dia_ch01_001-2A');
    expect(optA[2]).toBe('("背包#Item_Coin>0")');
    expect(optA[3]).toBe('("背包#Item_Coin>=10")');
    expect(optA[4]).toBe('("背包#Item_Coin-10")');
    expect(optA[5]).toBe('Dia_ch01_002-1');
  });

  it('本地化表只覆盖「对话」行与选项，顺序为选项行后紧跟其选项', () => {
    expect(rows.locale.slice(1).map((r) => r[0])).toEqual([
      'TXT_Dia_ch01_001-1',
      'TXT_Dia_ch01_001-2A',
      'TXT_Dia_ch01_001-2B',
      'TXT_Dia_ch01_002-1',
      'TXT_Dia_ch01_003-1',
    ]);
  });

  it('UI 本地化接在对话 / 选项的文本后面，排在同一张本地化表里', () => {
    const withUi = makeProject();
    withUi.uiTexts = [
      {
        uid: 'ui-1',
        key: 'TXT_Widget_开始游戏',
        text: { zh: '开始游戏', en: 'Start Game', ja: 'ゲーム開始' },
      },
      {
        uid: 'ui-2',
        key: 'TXT_Widget_设置',
        text: { zh: '设置', en: 'Setting', ja: '設定' },
      },
    ];

    const uiRows = buildRows(withUi);

    // 表头不变，UI 的行接在 5 条对话 / 选项文本之后
    expect(uiRows.locale).toHaveLength(8);
    expect(uiRows.locale.slice(6)).toEqual([
      ['TXT_Widget_开始游戏', '开始游戏', 'Start Game', 'ゲーム開始'],
      ['TXT_Widget_设置', '设置', 'Setting', '設定'],
    ]);
    // UI 文本不进对话表与选项表
    expect(uiRows.dialogue.flat()).not.toContain('开始游戏');
    expect(uiRows.options.flat()).not.toContain('开始游戏');
  });

  it('生成含三张工作表的 xlsx', async () => {
    const buffer = await exportWorkbook(project);
    const workbook = new ExcelJS.Workbook();
    // exceljs 自己声明的 Buffer 类型与 DOM 的 ArrayBuffer 名义不同，运行时可互换
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '对话',
      '选项',
      '本地化',
      'GASGameplayTags',
      'GAS属性',
      'GAS效果',
      'GAS技能',
      'GAS事件',
      'GAS角色',
      'GAS武器',
      '导入设置',
    ]);

    const dialogue = workbook.getWorksheet('对话');
    expect(dialogue?.getRow(2).getCell(1).value).toBe('Dia_ch01_001-1');
    expect(dialogue?.getRow(2).getCell(2).value).toBe('对话');
    expect(dialogue?.getRow(2).getCell(6).value).toBe('TXT_Dia_ch01_001-1');
    expect(dialogue?.getRow(3).getCell(2).value).toBe('选项');
    expect(dialogue?.getRow(4).getCell(8).value).toBe('("剧情.特殊# SP_ch01_001")');

    const options = workbook.getWorksheet('选项');
    expect(options?.getRow(2).getCell(3).value).toBe('("背包#Item_Coin>0")');

    const locale = workbook.getWorksheet('本地化');
    expect(locale?.getRow(2).getCell(2).value).toBe('你好');
  });

  it('备注只在软件里显示，不进任何一张导出表', () => {
    const withNote = makeProject();
    withNote.chapters[0].groups[0].lines[0].note = '这句要等 BGM 淡出';
    const noteRows = buildRows(withNote);

    for (const table of [noteRows.dialogue, noteRows.options, noteRows.locale]) {
      expect(table.flat().some((cell) => cell.includes('BGM'))).toBe(false);
    }
  });

  it('统计行数', () => {
    expect(countLines(project)).toEqual({ lines: 5, options: 2 });
  });
});
