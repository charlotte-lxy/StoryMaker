import { describe, expect, it } from 'vitest';

import { createEmptyBattle } from './battle';

import { buildChapterFlow, layoutChapterFlow, type FlowGeometry } from './flow';
import type { Chapter, Group, Line, Project, StoryOption } from './types';

function makeLine(uid: string, readableId: string, over: Partial<Line> = {}): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterUid: '',
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

function makeGroup(uid: string, id: string, title: string, over: Partial<Group> = {}): Group {
  return { uid, id, title, note: '', lines: [], options: [], ...over };
}

function makeChapter(uid: string, id: string, title: string, groups: Group[]): Chapter {
  return { uid, id, title, groups };
}

function makeProject(chapters: Chapter[]): Project {
  return {
    version: 1,
    name: '流程测试',
    characters: [],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    variables: [],
    uiTexts: [],
    nameTexts: [],
    battle: createEmptyBattle(),
    exportSettings: [],
    chapters,
  };
}

/**
 * 段落 001 里有一个「选项」行：
 *   o1 一定存在，跳到 targetNextId；
 *   传了 extraTarget 时再补一个选项 o2，也跳到 extraTarget（用来验合并）。
 */
function jumpProject(
  targetNextId: string,
  optionText = '去码头',
  extraTarget?: string,
  extraText = '留在原地',
): Project {
  const options = [
    makeOption('o1', 'Dia_ch01_001-1A', {
      nextId: targetNextId,
      text: { zh: optionText, en: '', ja: '' },
    }),
  ];
  const optionIds = ['o1'];
  if (extraTarget !== undefined) {
    options.push(
      makeOption('o2', 'Dia_ch01_001-1B', {
        nextId: extraTarget,
        text: { zh: extraText, en: '', ja: '' },
      }),
    );
    optionIds.push('o2');
  }

  const first = makeGroup('g1', '001', '开场', {
    lines: [makeLine('l1', 'Dia_ch01_001-1', { kind: '选项', optionIds })],
    options,
  });
  const second = makeGroup('g2', '002', '码头', {
    lines: [makeLine('l2', 'Dia_ch01_002-1', { text: { zh: '海风很大', en: '', ja: '' } })],
  });
  const other = makeChapter('c2', 'ch02', '第二章', [
    makeGroup('g9', '001', '别章段落', { lines: [makeLine('l9', 'Dia_ch02_001-1')] }),
  ]);

  return makeProject([makeChapter('c1', 'ch01', '序章', [first, second]), other]);
}

/** 段落 001 跳转到后面 n 个段落：同一串、子节点同层 */
function siblingProject(children: number): Project {
  const options: StoryOption[] = [];
  const optionIds: string[] = [];

  for (let index = 0; index < children; index += 1) {
    const uid = `o${index + 1}`;
    optionIds.push(uid);
    options.push(
      makeOption(uid, `Dia_ch01_001-1${String.fromCharCode(65 + index)}`, {
        nextId: `l${index + 2}`,
        text: { zh: `去第 ${index + 2} 段`, en: '', ja: '' },
      }),
    );
  }

  const groups: Group[] = [
    makeGroup('g1', '001', '开场', {
      lines: [makeLine('l1', 'Dia_ch01_001-1', { kind: '选项', optionIds })],
      options,
    }),
  ];

  for (let index = 0; index < children; index += 1) {
    const id = String(index + 2).padStart(3, '0');
    groups.push(
      makeGroup(`g${index + 2}`, id, `段落 ${id}`, {
        lines: [makeLine(`l${index + 2}`, `Dia_ch01_${id}-1`)],
      }),
    );
  }

  return makeProject([makeChapter('c1', 'ch01', '序章', groups)]);
}

/** 001→002、001→003、004→005、004→006，007 孤立 */
function mixedProject(): Project {
  const pairs: [string, string[], string[]][] = [
    ['001', ['002', '003'], ['l2', 'l3']],
    ['004', ['005', '006'], ['l5', 'l6']],
  ];

  const groups: Group[] = [];
  for (const [groupId, targets, targetLines] of pairs) {
    const options: StoryOption[] = [];
    const optionIds: string[] = [];
    targets.forEach((_, index) => {
      const uid = `o-${groupId}-${index}`;
      optionIds.push(uid);
      options.push(
        makeOption(uid, `Dia_ch01_${groupId}-1${String.fromCharCode(65 + index)}`, {
          nextId: targetLines[index],
          text: { zh: `去 ${targets[index]}`, en: '', ja: '' },
        }),
      );
    });
    groups.push(
      makeGroup(`g-${groupId}`, groupId, `段落 ${groupId}`, {
        lines: [
          makeLine(`l-${groupId}`, `Dia_ch01_${groupId}-1`, { kind: '选项', optionIds }),
        ],
        options,
      }),
    );
    targets.forEach((target, index) => {
      groups.push(
        makeGroup(`g-${target}`, target, `段落 ${target}`, {
          lines: [makeLine(targetLines[index], `Dia_ch01_${target}-1`)],
        }),
      );
    });
  }

  groups.push(
    makeGroup('g-007', '007', '段落 007', { lines: [makeLine('l7', 'Dia_ch01_007-1')] }),
  );

  return makeProject([makeChapter('c1', 'ch01', '序章', groups)]);
}

describe('章节流程图', () => {
  it('每个段落一个块，块上带段落号与行数', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1');
    expect(flow).not.toBeNull();
    expect(flow!.blocks.map((block) => block.title)).toEqual(['开场', '码头']);
    expect(flow!.blocks[0].meta).toBe('1 行 · 1 个选项');
  });

  it('选项跳到本章别的段落时连一条线，标签是选项文本', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1');
    expect(flow!.edges).toEqual([
      {
        key: 'g1->g2',
        from: 'g1',
        to: 'g2',
        label: '去码头',
        note: '跳到「码头」\n开场 · Dia_ch01_001-1：去码头',
        optionUids: ['o1'],
        lineUids: [],
      },
    ]);
  });

  it('同一对段落之间的多个选项合并成一条线，标签带 ×N', () => {
    const flow = buildChapterFlow(jumpProject('l2', '去码头', 'l2', '也可以去码头'), 'c1');
    expect(flow!.edges).toHaveLength(1);
    expect(flow!.edges[0].label).toBe('去码头 ×2');
    expect(flow!.edges[0].optionUids).toEqual(['o1', 'o2']);
    // 合并后的提示把两个选项都列出来
    expect(flow!.edges[0].note).toContain('也可以去码头');
  });

  it('「跳转到段落」行也连一条线，标签是它的段内序号，并记下是哪一行', () => {
    const first = makeGroup('g1', '001', '开场', {
      lines: [
        makeLine('l1', 'Dia_ch01_001-1', { text: { zh: '开场白', en: '', ja: '' } }),
        makeLine('l2', 'Dia_ch01_001-2', { kind: '指令', jumpGroupUid: 'g2' }),
      ],
    });
    const second = makeGroup('g2', '002', '码头', {
      lines: [makeLine('l3', 'Dia_ch01_002-1')],
    });
    const flow = buildChapterFlow(makeProject([makeChapter('c1', 'ch01', '序章', [first, second])]), 'c1');

    expect(flow!.edges).toEqual([
      {
        key: 'g1->g2',
        from: 'g1',
        to: 'g2',
        label: '2',
        note: '跳到「码头」\n开场 · Dia_ch01_001-2：跳到「码头」',
        optionUids: [],
        lineUids: ['l2'],
      },
    ]);
  });

  it('选项和「跳转到段落」跳去同一段时合并成一条线', () => {
    const base = jumpProject('l2');
    base.chapters[0].groups[0].lines.push(
      makeLine('l3', 'Dia_ch01_001-2', { kind: '指令', jumpGroupUid: 'g2' }),
    );
    const flow = buildChapterFlow(base, 'c1');

    expect(flow!.edges).toHaveLength(1);
    expect(flow!.edges[0].label).toBe('去码头 ×2');
    expect(flow!.edges[0].optionUids).toEqual(['o1']);
    expect(flow!.edges[0].lineUids).toEqual(['l3']);
  });

  it('跳到自己、跳到别章、还没选段落的都不画线', () => {
    const first = makeGroup('g1', '001', '开场', {
      lines: [
        makeLine('l1', 'Dia_ch01_001-1', { kind: '指令', jumpGroupUid: 'g1' }),
        makeLine('l2', 'Dia_ch01_001-2', { kind: '指令', jumpGroupUid: 'g9' }),
        makeLine('l3', 'Dia_ch01_001-3', { kind: '指令', jumpGroupUid: '' }),
      ],
    });
    const second = makeGroup('g2', '002', '码头', { lines: [makeLine('l4', 'Dia_ch01_002-1')] });
    const other = makeChapter('c2', 'ch02', '第二章', [makeGroup('g9', '001', '别章段落')]);
    const flow = buildChapterFlow(
      makeProject([makeChapter('c1', 'ch01', '序章', [first, second]), other]),
      'c1',
    );

    expect(flow!.edges).toEqual([]);
  });

  it('横轴按连接深度分层：被跳转到的段落排到右边一列', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1');
    // 001 没有被任何人跳进来 → 第一列；002 被 001 跳进来 → 第二列
    expect(flow!.blocks.map((block) => [block.id, block.layer])).toEqual([
      ['001', 0],
      ['002', 1],
    ]);
  });

  it('选项文本为空时标签退回选项 ID', () => {
    const flow = buildChapterFlow(jumpProject('l2', ''), 'c1');
    expect(flow!.edges[0].label).toBe('Dia_ch01_001-1A');
  });

  it('跳回本段落自己的选项不画线', () => {
    const flow = buildChapterFlow(jumpProject('l1'), 'c1');
    expect(flow!.edges).toEqual([]);
  });

  it('跳到其他章节的段落不画线（这种情况由校验层提示）', () => {
    const flow = buildChapterFlow(jumpProject('l9'), 'c1');
    expect(flow!.edges).toEqual([]);
    expect(flow!.blocks.map((block) => block.title)).toEqual(['开场', '码头']);
  });

  it('跳转目标悬空时不画线', () => {
    const flow = buildChapterFlow(jumpProject('u-missing'), 'c1');
    expect(flow!.edges).toEqual([]);
  });

  it('章节不存在时返回 null', () => {
    expect(buildChapterFlow(jumpProject('l2'), 'c-missing')).toBeNull();
  });
});

describe('流程图布局', () => {
  /** 竖排：一层往下走一层，同一层里按段落顺序横向铺开 */
  const geo: FlowGeometry = {
    blockWidth: 200,
    blockHeight: 50,
    noteLineHeight: 16,
    rowGap: 20,
    columnGap: 16,
    layerGap: 60,
    pad: 20,
    laneStart: 20,
    laneStep: 12,
    availableWidth: 600, // 一行放得下 2 个块
  };

  it('层往下排：第一层的段落在上，被它跳转到的段落在下一层', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1')!;
    const layout = layoutChapterFlow(flow, geo);

    expect(layout.blocks[0]).toMatchObject({ x: 20, y: 20 });
    // 第二层：y = 20 + 50 + 60（层间距）
    expect(layout.blocks[1]).toMatchObject({ x: 20, y: 130 });
    expect(layout.blockWidth).toBe(200);
  });

  it('向下的线从源块下边中间拉到目标块上边中间，标签落在两层之间的带子里', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1')!;
    const layout = layoutChapterFlow(flow, geo);
    const route = layout.edges[0];

    expect(route.d).toBe('M 120 70 C 120 100, 120 100, 120 130');
    expect(route.labelX).toBe(120);
    expect(route.labelY).toBe(100);
  });

  it('同一串里同层的段落横向铺开，一行放不下就折行', () => {
    // 001 跳转到 002、003、004：三个子节点在同一层
    const layout = layoutChapterFlow(buildChapterFlow(siblingProject(3), 'c1')!, geo);

    // 第一行父节点；第二行两个子节点；第三个子节点折到第三行
    expect(layout.blocks.map((item) => [item.x, item.y])).toEqual([
      [20, 20],
      [20, 130],
      [236, 130],
      [20, 200],
    ]);
  });

  it('无关的链条各自成串，纵向依次往下排', () => {
    // 001→002、001→003、004→005、004→006，007 孤立
    const project = mixedProject();
    const flow = buildChapterFlow(project, 'c1')!;

    expect(flow.blocks.map((block) => [block.id, block.component, block.layer])).toEqual([
      ['001', 0, 0],
      ['002', 0, 1],
      ['003', 0, 1],
      ['004', 1, 0],
      ['005', 1, 1],
      ['006', 1, 1],
      ['007', 2, 0],
    ]);

    const layout = layoutChapterFlow(flow, geo);
    // 行序：001 ／ 002 003 ／ 004 ／ 005 006 ／ 007
    const rows = new Map<number, string[]>();
    for (const item of layout.blocks) {
      const row = rows.get(item.y) ?? [];
      row.push(item.block.id);
      rows.set(item.y, row);
    }
    expect([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids)).toEqual([
      ['001'],
      ['002', '003'],
      ['004'],
      ['005', '006'],
      ['007'],
    ]);
  });

  it('同一行内的线走右侧绕行，标签互相错开', () => {
    // 002 跳回 001：两个段落互为来源和终点，都没有入口 → 同在第一层同一行
    const project = jumpProject('l2');
    const chapter = project.chapters[0];
    const second = chapter.groups[1];
    second.lines = [makeLine('l2', 'Dia_ch01_002-1', { kind: '选项', optionIds: ['o9'] })];
    second.options = [
      makeOption('o9', 'Dia_ch01_002-1A', { nextId: 'l1', text: { zh: '回开场', en: '', ja: '' } }),
    ];

    const flow = buildChapterFlow(project, 'c1')!;
    expect(flow.blocks.map((block) => block.layer)).toEqual([0, 0]);

    const layout = layoutChapterFlow(flow, geo);
    expect(layout.edges).toHaveLength(2);
    // 两条线的标签不在同一个点上
    const spots = layout.edges.map((route) => `${route.labelX},${route.labelY}`);
    expect(new Set(spots).size).toBe(2);
  });

  it('画布尺寸容得下块和标签', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1')!;
    const layout = layoutChapterFlow(flow, geo);

    expect(layout.width).toBeGreaterThanOrEqual(20 + 200 + 20);
    expect(layout.height).toBeGreaterThanOrEqual(130 + 50);
  });

  it('段落注释会把块撑高，同一行按最高的那个占位', () => {
    // 001 跳转到 002、003：父块与两个子块
    const project = siblingProject(2);
    const chapter = project.chapters[0];

    const before = layoutChapterFlow(buildChapterFlow(project, 'c1')!, geo);
    expect(before.blocks.map((item) => item.height)).toEqual([50, 50, 50]);
    const childY = before.blocks[1].y;

    // 给父块写一段长注释（估算会多占几行）
    chapter.groups[0].note = '这是一段很长的段落注释，用来看块会不会随着内容自动向下延伸。';
    const after = layoutChapterFlow(buildChapterFlow(project, 'c1')!, geo);

    expect(after.blocks[0].height).toBeGreaterThan(50);
    // 同一行里的子块本身不变高，但整行被顶下去了
    expect(after.blocks[1].height).toBe(50);
    expect(after.blocks[1].y).toBeGreaterThan(childY);
  });

  it('量到真实高度时以实测为准', () => {
    const flow = buildChapterFlow(jumpProject('l2'), 'c1')!;
    const layout = layoutChapterFlow(flow, {
      ...geo,
      measuredHeights: { g1: 88 },
    });

    expect(layout.blocks[0].height).toBe(88);
    // 第二层的起始位置跟着第一块的真实高度走：20 + 88 + 60
    expect(layout.blocks[1].y).toBe(168);
    // 向下的线从第一块下边出发
    expect(layout.edges[0].d.startsWith('M 120 108')).toBe(true);
  });
});
