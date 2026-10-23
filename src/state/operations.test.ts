import { describe, expect, it } from 'vitest';

import { createEmptyBattle } from '../core/battle';

import type { Line, Project } from '../core/types';
import {
  addCommandDef,
  addCommandModule,
  addAssetCategory,
  addLookupRow,
  addUiText,
  collectGroupedLineRefs,
  commandModulesOf,
  groupUidOfLine,
  insertLine,
  moveLines,
  moveLinesTogether,
  mutate,
  removeCommandModule,
  removeAssetCategory,
  removeLines,
  removeUiText,
  renameCommandBranch,
  renameCommandModule,
  renameCommandParam,
  renumberOneGroup,
  reorderCommandParam,
  reorderLine,
  updateAssetCategory,
  updateTextByUid,
  updateUiText,
} from './operations';
import { buildDelayCommand } from '../core/command-build';

function makeLine(uid: string, readableId: string, zh: string): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterUid: '',
    displayAliasUid: '',
    text: { zh, en: '', ja: '' },
    autoAdvance: false,
    jumpGroupUid: null,
    jumpConditions: [],
    command: '',
    specialContent: null,
    optionIds: [],
    note: '',
  };
}

function makeProject(): Project {
  return {
    version: 1,
    name: 'p',
    characters: [],
    sounds: [],
    commands: [],
    items: [],
    quests: [],
    images: [],
    imageCategories: [],
    soundCategories: [],
    variables: [],
    uiTexts: [],
    battle: createEmptyBattle(),
    specialCommandClassPrefix: '',
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
              makeLine('a', 'Dia_ch01_001-1', '第一句'),
              makeLine('b', 'Dia_ch01_001-2', '第二句'),
              makeLine('c', 'Dia_ch01_001-3', '第三句'),
            ],
            options: [],
          },
        ],
      },
    ],
  };
}

describe('拖拽排序', () => {
  it('把最后一行拖到最前，ID 自动重新编号且文本不错位', () => {
    const project = makeProject();
    const next = renumberOneGroup(reorderLine(project, 'g1', 2, 0), 'g1');
    const lines = next.chapters[0].groups[0].lines;

    expect(lines.map((l) => l.uid)).toEqual(['c', 'a', 'b']);
    expect(lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
    ]);
    // 文本挂在 uid 上，因此跟着行一起移动，不会串位
    expect(lines.map((l) => l.text.zh)).toEqual(['第三句', '第一句', '第二句']);
  });

  it('往下拖同样有效', () => {
    const project = makeProject();
    const next = renumberOneGroup(reorderLine(project, 'g1', 0, 2), 'g1');
    const lines = next.chapters[0].groups[0].lines;

    expect(lines.map((l) => l.uid)).toEqual(['b', 'c', 'a']);
    expect(lines.map((l) => l.text.zh)).toEqual(['第二句', '第三句', '第一句']);
  });

  it('原地拖拽不改变任何东西', () => {
    const project = makeProject();
    const next = renumberOneGroup(reorderLine(project, 'g1', 1, 1), 'g1');
    expect(next.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'b', 'c']);
  });

  it('越界下标被安全忽略', () => {
    const project = makeProject();
    const next = reorderLine(project, 'g1', 0, 99);
    expect(next.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'b', 'c']);
  });

  it('原项目对象不被就地修改', () => {
    const project = makeProject();
    renumberOneGroup(reorderLine(project, 'g1', 2, 0), 'g1');
    expect(project.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'b', 'c']);
  });
});

describe('插入脚本块', () => {
  it('插到中间，ID 自动重排且编号连续', () => {
    const project = makeProject();
    const next = renumberOneGroup(insertLine(project, 'g1', 1, '指令'), 'g1');
    const lines = next.chapters[0].groups[0].lines;

    expect(lines).toHaveLength(4);
    expect(lines[1].kind).toBe('指令');
    expect(lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
      'Dia_ch01_001-4',
    ]);
    // 插入前那三行的文本跟着各自的 uid 走，不会串位
    expect(lines.map((l) => l.text.zh)).toEqual(['第一句', '', '第二句', '第三句']);
  });

  it('插到末尾和插到最前都可以', () => {
    const project = makeProject();
    const atEnd = renumberOneGroup(insertLine(project, 'g1', 3, '选项'), 'g1');
    expect(atEnd.chapters[0].groups[0].lines.map((l) => l.kind)).toEqual([
      '对话',
      '对话',
      '对话',
      '选项',
    ]);

    const atStart = renumberOneGroup(insertLine(project, 'g1', 0, '指令'), 'g1');
    expect(atStart.chapters[0].groups[0].lines.map((l) => l.kind)).toEqual([
      '指令',
      '对话',
      '对话',
      '对话',
    ]);
  });

  it('插入「选项」行时自带一个选项，编号跟着行走', () => {
    const project = makeProject();
    const next = renumberOneGroup(insertLine(project, 'g1', 1, '选项'), 'g1');
    const group = next.chapters[0].groups[0];
    const line = group.lines[1];

    expect(line.kind).toBe('选项');
    expect(line.optionIds).toHaveLength(1);
    expect(group.options).toHaveLength(1);
    // 选项 ID = 所属行的 ID + 字母后缀
    expect(group.options[0].readableId).toBe('Dia_ch01_001-2A');
  });

  it('越界的插入点会被夹到合法范围', () => {
    const project = makeProject();
    const next = insertLine(project, 'g1', 99, '指令');
    expect(next.chapters[0].groups[0].lines[3].kind).toBe('指令');
  });
});

describe('批量编辑：移动与删除', () => {
  /**
   * 段落 001 有 a / b / c 三句，外加一条挂着选项的「选项」行；
   * 同章另有段落 002，第二章 ch02 里还有一个段落。
   */
  function makeBatchProject(): Project {
    const project = makeProject();
    const group = project.chapters[0].groups[0];
    group.lines.push({
      ...makeLine('d', 'Dia_ch01_001-4', ''),
      kind: '选项',
      optionIds: ['o1'],
    });
    group.options.push({
      uid: 'o1',
      readableId: 'Dia_ch01_001-4A',
      text: { zh: '去码头', en: '', ja: '' },
      nextId: 'a',
      appearConditions: [],
      enableConditions: [],
    });
    project.chapters[0].groups.push({
      uid: 'g2',
      id: '002',
      title: '码头',
      note: '',
      lines: [makeLine('y', 'Dia_ch01_002-1', '码头的一句')],
      options: [],
    });
    project.chapters.push({
      uid: 'c2',
      id: 'ch02',
      title: '第二章',
      groups: [
        {
          uid: 'g3',
          id: '001',
          title: '另一章',
          note: '',
          lines: [makeLine('z', 'Dia_ch02_001-1', '另一章的一句')],
          options: [],
        },
      ],
    });
    return project;
  }

  it('同段落内搬动：按选中顺序追加到目标末尾，两边都重新编号', () => {
    const next = moveLines(makeBatchProject(), 'g1', ['a', 'c'], 'g2');
    const from = next.chapters[0].groups[0];
    const to = next.chapters[0].groups[1];

    expect(from.lines.map((l) => l.uid)).toEqual(['b', 'd']);
    expect(from.lines.map((l) => l.text.zh)).toEqual(['第二句', '']);
    expect(from.lines.map((l) => l.readableId)).toEqual(['Dia_ch01_001-1', 'Dia_ch01_001-2']);
    // 选项行的选项跟着宿主行一起换了 ID
    expect(from.options[0].readableId).toBe('Dia_ch01_001-2A');

    expect(to.lines.map((l) => l.uid)).toEqual(['y', 'a', 'c']);
    expect(to.lines.map((l) => l.text.zh)).toEqual(['码头的一句', '第一句', '第三句']);
    expect(to.lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_002-1',
      'Dia_ch01_002-2',
      'Dia_ch01_002-3',
    ]);
  });

  it('跨章节搬动：ID 前缀换成新章节，「选项」行的选项一起搬', () => {
    const next = moveLines(makeBatchProject(), 'g1', ['d'], 'g3');
    const from = next.chapters[0].groups[0];
    const to = next.chapters[1].groups[0];

    // 原来那个段落里只剩三句，编号连起来；挂过的选项跟着走了，不留孤儿
    expect(from.lines.map((l) => l.uid)).toEqual(['a', 'b', 'c']);
    expect(from.options).toHaveLength(0);

    expect(to.lines.map((l) => l.uid)).toEqual(['z', 'd']);
    expect(to.lines[1].readableId).toBe('Dia_ch02_001-2');
    expect(to.options).toHaveLength(1);
    expect(to.options[0].readableId).toBe('Dia_ch02_001-2A');
    // 选项内容与跳转目标（指向 uid）都不受影响
    expect(to.options[0].text.zh).toBe('去码头');
    expect(to.options[0].nextId).toBe('a');
  });

  it('搬到当前段落、或目标段落不存在时，什么都不做', () => {
    const project = makeBatchProject();
    expect(moveLines(project, 'g1', ['a'], 'g1').chapters[0].groups[0].lines).toHaveLength(4);
    expect(moveLines(project, 'g1', ['a'], '不存在').chapters[0].groups[0].lines).toHaveLength(4);
  });

  it('批量删除：一次删掉多行，连同它们的选项一起删，其它段落不动', () => {
    const next = removeLines(makeBatchProject(), 'g1', ['b', 'd']);
    const group = next.chapters[0].groups[0];

    expect(group.lines.map((l) => l.uid)).toEqual(['a', 'c']);
    // 「选项」行被删掉时，它挂着的选项不能留下来
    expect(group.options).toHaveLength(0);
    expect(next.chapters[0].groups[1].lines.map((l) => l.uid)).toEqual(['y']);
    expect(next.chapters[1].groups[0].lines.map((l) => l.uid)).toEqual(['z']);
  });

  it('搬到别的段落时能选插到开头', () => {
    const next = moveLines(makeBatchProject(), 'g1', ['a', 'c'], 'g2', 'start');
    const to = next.chapters[0].groups[1];

    // 「码头」原来那一行被挤到后面去
    expect(to.lines.map((l) => l.uid)).toEqual(['a', 'c', 'y']);
    expect(to.lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_002-1',
      'Dia_ch01_002-2',
      'Dia_ch01_002-3',
    ]);
  });

  it('目标是当前段落时：整组挪到本段最前 / 最后', () => {
    const toStart = moveLines(makeBatchProject(), 'g1', ['c'], 'g1', 'start');
    expect(toStart.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['c', 'a', 'b', 'd']);

    const toEnd = moveLines(makeBatchProject(), 'g1', ['a'], 'g1', 'end');
    expect(toEnd.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('原项目对象不被就地修改', () => {
    const project = makeBatchProject();
    moveLines(project, 'g1', ['a'], 'g2');
    removeLines(project, 'g1', ['b']);

    expect(project.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'b', 'c', 'd']);
    expect(project.chapters[0].groups[0].options).toHaveLength(1);
    expect(project.chapters[0].groups[1].lines.map((l) => l.uid)).toEqual(['y']);
  });
});

describe('批量拖拽排序（整组搬）', () => {
  /** 一段五句：a b c d e，就是例子里那 ABCDE */
  function fiveLines(): Project {
    const project = makeProject();
    project.chapters[0].groups[0].lines.push(
      makeLine('d', 'Dia_ch01_001-4', '第四句'),
      makeLine('e', 'Dia_ch01_001-5', '第五句'),
    );
    return project;
  }

  it('勾了 C、E 拖到 A 与 B 之间：得到 ACEBD', () => {
    // insertAt = 1 表示插到第 2 行（b）之前
    const next = renumberOneGroup(moveLinesTogether(fiveLines(), 'g1', ['c', 'e'], 1), 'g1');
    const lines = next.chapters[0].groups[0].lines;

    expect(lines.map((l) => l.uid)).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(lines.map((l) => l.text.zh)).toEqual(['第一句', '第三句', '第五句', '第二句', '第四句']);
    // 编号按新顺序连续排
    expect(lines.map((l) => l.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
      'Dia_ch01_001-4',
      'Dia_ch01_001-5',
    ]);
  });

  it('搬到最前和最后都可以，勾中的行保持原来的先后顺序', () => {
    const toTop = moveLinesTogether(fiveLines(), 'g1', ['d', 'b'], 0);
    expect(toTop.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['b', 'd', 'a', 'c', 'e']);

    const toEnd = moveLinesTogether(fiveLines(), 'g1', ['b', 'd'], 5);
    expect(toEnd.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('一行都没勾、或者整段都勾上时不动', () => {
    const project = fiveLines();
    expect(moveLinesTogether(project, 'g1', [], 0).chapters[0].groups[0].lines).toHaveLength(5);
    expect(
      moveLinesTogether(project, 'g1', ['a', 'b', 'c', 'd', 'e'], 0).chapters[0].groups[0].lines.map(
        (l) => l.uid,
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('原项目对象不被就地修改', () => {
    const project = fiveLines();
    moveLinesTogether(project, 'g1', ['c'], 0);
    expect(project.chapters[0].groups[0].lines.map((l) => l.uid)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('插入「跳转到段落」块', () => {
  it('插出来的是「指令」行，带着一个还没填的段落引用', () => {
    const next = renumberOneGroup(insertLine(makeProject(), 'g1', 1, '跳转到段落'), 'g1');
    const line = next.chapters[0].groups[0].lines[1];

    expect(line.kind).toBe('指令');
    // null 表示"不是跳转行"，空串表示"是跳转行但还没选段落"
    expect(line.jumpGroupUid).toBe('');
    expect(line.command).toBe('');
  });

  it('普通块插出来的行不是跳转行', () => {
    const next = insertLine(makeProject(), 'g1', 0, '指令');
    expect(next.chapters[0].groups[0].lines[0].jumpGroupUid).toBeNull();
  });
});

describe('插入「特殊演出效果」块', () => {
  it('插出来的是「指令」行，带着一个还没填的指令内容', () => {
    const next = renumberOneGroup(insertLine(makeProject(), 'g1', 1, '特殊演出效果'), 'g1');
    const line = next.chapters[0].groups[0].lines[1];

    expect(line.kind).toBe('指令');
    // null 表示"不是特殊演出效果行"，空串表示"是但还没填内容"
    expect(line.specialContent).toBe('');
    expect(line.jumpGroupUid).toBeNull();
    expect(line.command).toBe('');
  });

  it('普通块插出来的行不是特殊演出效果行', () => {
    const next = insertLine(makeProject(), 'g1', 0, '指令');
    expect(next.chapters[0].groups[0].lines[0].specialContent).toBeNull();
  });
});

describe('本地化文本编辑', () => {  it('按 uid 改写某一语言，不影响其它语言与其它行', () => {
    const project = makeProject();
    const next = updateTextByUid(project, 'b', 'ja', '二番目');
    const lines = next.chapters[0].groups[0].lines;

    expect(lines[1].text.ja).toBe('二番目');
    expect(lines[1].text.zh).toBe('第二句');
    expect(lines[0].text.ja).toBe('');
  });

  it('重排之后仍能按 uid 定位到正确的行', () => {
    const moved = renumberOneGroup(reorderLine(makeProject(), 'g1', 2, 0), 'g1');
    const edited = updateTextByUid(moved, 'a', 'en', 'First line');
    const lines = edited.chapters[0].groups[0].lines;

    // uid 'a' 现在是第二行，ID 变成了 -2
    expect(lines[1].uid).toBe('a');
    expect(lines[1].readableId).toBe('Dia_ch01_001-2');
    expect(lines[1].text.en).toBe('First line');
    expect(lines[1].text.zh).toBe('第一句');
  });
});

describe('UI 本地化条目', () => {
  it('新增一条：插在列表最前面，key 去掉首尾空格', () => {
    const project = makeProject();
    project.uiTexts = [{ uid: 'ui-1', key: 'TXT_UI_1', text: { zh: '一', en: '', ja: '' } }];

    const next = addUiText(project, '  TXT_Widget_开始游戏  ', {
      zh: '开始游戏',
      en: 'Start Game',
      ja: 'ゲーム開始',
    });

    expect(next.uiTexts).toHaveLength(2);
    expect(next.uiTexts[0].key).toBe('TXT_Widget_开始游戏');
    expect(next.uiTexts[0].text.ja).toBe('ゲーム開始');
    expect(next.uiTexts[0].uid).not.toBe('');
    // 原来那条还在，而且没被就地改过
    expect(next.uiTexts[1].uid).toBe('ui-1');
    expect(project.uiTexts).toHaveLength(1);
  });

  it('改 key 与改译文都只动那一行', () => {
    const project = makeProject();
    project.uiTexts = [
      { uid: 'ui-1', key: 'TXT_UI_1', text: { zh: '新游戏', en: '', ja: '' } },
      { uid: 'ui-2', key: 'TXT_Widget_菜单', text: { zh: '菜单', en: 'Menu', ja: 'メニュー' } },
    ];

    const renamed = updateUiText(project, 'ui-1', { key: 'TXT_Widget_新游戏' });
    expect(renamed.uiTexts[0].key).toBe('TXT_Widget_新游戏');

    const translated = updateUiText(renamed, 'ui-1', {
      text: { zh: '新游戏', en: 'New Game', ja: 'ニューゲーム' },
    });
    expect(translated.uiTexts[0].text).toEqual({
      zh: '新游戏',
      en: 'New Game',
      ja: 'ニューゲーム',
    });
    expect(translated.uiTexts[1].text.ja).toBe('メニュー');
    // 原对象不被就地修改
    expect(project.uiTexts[0].key).toBe('TXT_UI_1');
  });

  it('删除只拿掉指定的一行', () => {
    const project = makeProject();
    project.uiTexts = [
      { uid: 'ui-1', key: 'TXT_UI_1', text: { zh: '一', en: '', ja: '' } },
      { uid: 'ui-2', key: 'TXT_UI_2', text: { zh: '二', en: '', ja: '' } },
    ];

    const next = removeUiText(project, 'ui-1');

    expect(next.uiTexts.map((row) => row.uid)).toEqual(['ui-2']);
  });
});

describe('跳转目标的两级下拉', () => {
  it('按章节 / 段落分组，并带上可读 ID 与台词预览', () => {
    const grouped = collectGroupedLineRefs(makeProject());
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe('序章 / 开场');
    expect(grouped[0].lines.map((line) => line.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
    ]);
    expect(grouped[0].lines[0].preview).toBe('第一句');
  });

  it('按目标行反查它所属的段落', () => {
    const grouped = collectGroupedLineRefs(makeProject());
    expect(groupUidOfLine(grouped, 'b')).toBe('g1');
  });

  it('空目标（对话结束）反查为空字符串', () => {
    const grouped = collectGroupedLineRefs(makeProject());
    expect(groupUidOfLine(grouped, '')).toBe('');
  });

  it('目标已失效时反查为空字符串，交由校验层报告', () => {
    const grouped = collectGroupedLineRefs(makeProject());
    expect(groupUidOfLine(grouped, 'u-missing')).toBe('');
  });
});

describe('指令字典按模块分组与改名', () => {
  /** 两个模块：剧情/演出（带参数）+ 背包（无分支）；剧情里两条指令分别用它们 */
  function makeDictProject(): Project {
    const project = makeProject();
    const perform = {
      uid: 'def-perform',
      category: '指令' as const,
      head: '剧情',
      branch: '演出',
      note: '',
      params: [
        { uid: 'p-role', name: '角色', source: 'character' as const, options: [], required: true, note: '' },
        { uid: 'p-face', name: '表情', source: 'expression' as const, options: [], required: false, note: '' },
      ],
    };
    const bag = {
      uid: 'def-bag',
      category: '指令' as const,
      head: '背包',
      branch: '',
      note: '',
      params: [
        { uid: 'p-item', name: '物品', source: 'item' as const, options: [], required: true, note: '' },
        { uid: 'p-op', name: '运算符', source: 'fixed' as const, options: ['+', '-'], required: true, note: '' },
        { uid: 'p-count', name: '数量', source: 'number' as const, options: [], required: true, note: '' },
      ],
    };
    project.commands = [perform, bag];
    project.chapters[0].groups[0].lines = [
      makeLine('a', 'Dia_ch01_001-1', '第一句'),
      { ...makeLine('b', 'Dia_ch01_001-2', ''), kind: '指令', command: '剧情|演出|角色:CHA_伊芙;表情:开心' },
      { ...makeLine('c', 'Dia_ch01_001-3', ''), kind: '指令', command: '背包||物品:Item_Coin;运算符:+;数量:1' },
    ];
    return project;
  }

  const commandAt = (project: Project, index: number): string =>
    project.chapters[0].groups[0].lines[index].command;

  it('按类别分组，模块顺序按字典里第一次出现排', () => {
    const project = makeDictProject();
    expect(commandModulesOf(project, '指令').map((module) => module.head)).toEqual(['剧情', '背包']);
    expect(commandModulesOf(project, '条件')).toEqual([]);
  });

  it('新增模块：先建一条分支留空的条目，同类别里重名不加', () => {
    const project = addCommandModule(makeDictProject(), '指令', '任务');
    expect(commandModulesOf(project, '指令').map((module) => module.head)).toEqual([
      '剧情',
      '背包',
      '任务',
    ]);
    const def = project.commands.find((item) => item.head === '任务');
    expect(def?.branch).toBe('');
    expect(def?.params).toEqual([]);

    // 重名不加
    expect(addCommandModule(project, '指令', '背包').commands).toHaveLength(3);
  });

  it('删除模块：连同它下面的条目一起删', () => {
    const project = removeCommandModule(makeDictProject(), '指令', '剧情');
    expect(project.commands.map((item) => item.head)).toEqual(['背包']);
  });

  it('模块里新增条目：分支名自动避开已占用的', () => {
    const project = addCommandDef(makeDictProject(), '指令', '剧情');
    const branches = project.commands
      .filter((item) => item.head === '剧情')
      .map((item) => item.branch);
    expect(branches).toEqual(['演出', '新分支']);
  });

  it('改模块名：该模块条目与剧情里用到它的指令一起改，别的模块不动', () => {
    const project = renameCommandModule(makeDictProject(), '指令', '剧情', '演出');
    expect(project.commands.map((item) => item.head)).toEqual(['演出', '背包']);
    expect(commandAt(project, 1)).toBe('演出|演出|角色:CHA_伊芙;表情:开心');
    // 别的模块的指令原样
    expect(commandAt(project, 2)).toBe('背包||物品:Item_Coin;运算符:+;数量:1');
  });

  it('改模块名撞上已有模块时不动', () => {
    const project = makeDictProject();
    const next = renameCommandModule(project, '指令', '剧情', '背包');
    expect(next.commands.map((item) => item.head)).toEqual(['剧情', '背包']);
    expect(commandAt(next, 1)).toBe('剧情|演出|角色:CHA_伊芙;表情:开心');
  });

  it('改分支名：条目与用到它的指令一起改；同模块里重名不动', () => {
    const project = renameCommandBranch(makeDictProject(), 'def-perform', '出场');
    expect(project.commands[0].branch).toBe('出场');
    expect(commandAt(project, 1)).toBe('剧情|出场|角色:CHA_伊芙;表情:开心');

    const clash = makeDictProject();
    clash.commands.push({
      uid: 'def-other',
      category: '指令',
      head: '剧情',
      branch: '图片',
      params: [],
      note: '',
    });
    const next = renameCommandBranch(clash, 'def-perform', '图片');
    expect(next.commands[0].branch).toBe('演出');
  });

  it('改参数名：参数本身与所有用到它的指令一起改', () => {
    const project = renameCommandParam(makeDictProject(), 'def-bag', 'p-op', '运算');
    expect(project.commands[1].params[1].name).toBe('运算');
    expect(commandAt(project, 2)).toBe('背包||物品:Item_Coin;运算:+;数量:1');
    // 别的参数不动
    expect(commandAt(project, 1)).toBe('剧情|演出|角色:CHA_伊芙;表情:开心');
  });

  it('改参数名撞上同条目的已有参数时不动', () => {
    const project = makeDictProject();
    const next = renameCommandParam(project, 'def-bag', 'p-op', '物品');
    expect(next.commands[1].params[1].name).toBe('运算符');
    expect(commandAt(next, 2)).toBe('背包||物品:Item_Coin;运算符:+;数量:1');
  });

  it('改参数名只改本条目对应分支的指令，别的分支不受影响', () => {
    const project = makeDictProject();
    project.commands.push({
      uid: 'def-picture',
      category: '指令',
      head: '剧情',
      branch: '图片',
      params: [
        { uid: 'p-pic', name: '图片', source: 'image', options: [], required: true, note: '' },
        { uid: 'p-role2', name: '角色', source: 'character', options: [], required: false, note: '' },
      ],
      note: '',
    });
    project.chapters[0].groups[0].lines.push({
      ...makeLine('d', 'Dia_ch01_001-4', ''),
      kind: '指令',
      command: '剧情|图片|图片:SCE_1;角色:CHA_伊芙',
    });

    const next = renameCommandParam(project, 'def-picture', 'p-role2', '出场角色');
    expect(next.chapters[0].groups[0].lines[3].command).toBe('剧情|图片|图片:SCE_1;出场角色:CHA_伊芙');
    // 演出那条里的「角色」是另一个参数，不动
    expect(commandAt(next, 1)).toBe('剧情|演出|角色:CHA_伊芙;表情:开心');
  });

  it('改条件里的参数名：只改条件槽位，不动同名模块的指令', () => {
    const project = makeDictProject();
    project.commands.push({
      uid: 'def-cond',
      category: '条件',
      head: '剧情',
      branch: '',
      params: [{ uid: 'p-line', name: '对话', source: 'line', options: [], required: true, note: '' }],
      note: '',
    });
    project.chapters[0].groups[0].options = [
      {
        uid: 'o1',
        readableId: 'Dia_ch01_001-2A',
        text: { zh: '选项', en: '', ja: '' },
        nextId: '',
        appearConditions: ['剧情||对话:Dia_ch01_001-1'],
        enableConditions: [],
      },
    ];

    const next = renameCommandParam(project, 'def-cond', 'p-line', '对话ID');
    expect(next.chapters[0].groups[0].options[0].appearConditions).toEqual([
      '剧情||对话ID:Dia_ch01_001-1',
    ]);
    // 「指令」类别里同名模块的指令不动
    expect(commandAt(next, 1)).toBe('剧情|演出|角色:CHA_伊芙;表情:开心');
  });

  it('参数拖拽排序：下标对调，参数名跟着走', () => {
    const project = reorderCommandParam(makeDictProject(), 'def-bag', 2, 0);
    expect(project.commands[1].params.map((param) => param.name)).toEqual([
      '数量',
      '物品',
      '运算符',
    ]);
    // 顺序只影响填写界面的摆放，已写好的指令文本不变
    expect(commandAt(project, 2)).toBe('背包||物品:Item_Coin;运算符:+;数量:1');
  });

  it('参数拖拽排序越界 / 原地不动时原样返回', () => {
    const project = makeDictProject();
    expect(reorderCommandParam(project, 'def-bag', 0, 0).commands[1].params.map((p) => p.name)).toEqual(
      ['物品', '运算符', '数量'],
    );
    expect(reorderCommandParam(project, 'def-bag', 0, 9).commands[1].params.map((p) => p.name)).toEqual(
      ['物品', '运算符', '数量'],
    );
  });
});

describe('延时脚本块', () => {
  it('插一条「指令」行，指令文本先立成「其他|延时|」', () => {
    const project = insertLine(makeProject(), 'g1', 1, '延时');
    const line = project.chapters[0].groups[0].lines[1];
    expect(line.kind).toBe('指令');
    expect(line.command).toBe('其他|延时|');
    expect(line.specialContent).toBeNull();
    expect(line.jumpGroupUid).toBeNull();
  });

  it('填了秒数之后指令是「其他|延时|时长:0.5」', () => {
    const project = insertLine(makeProject(), 'g1', 1, '延时');
    const line = project.chapters[0].groups[0].lines[1];
    const next = mutate(project, (draft) => {
      const target = draft.chapters[0].groups[0].lines[1];
      target.command = buildDelayCommand('0.5');
    });
    expect(line.command).toBe('其他|延时|');
    expect(next.chapters[0].groups[0].lines[1].command).toBe('其他|延时|时长:0.5');
  });
});

describe('资源分类（图片分类 / 音效类型）', () => {
  const imageNames = (project: Project): string[] => project.imageCategories.map((row) => row.name);
  const soundNames = (project: Project): string[] => project.soundCategories.map((row) => row.name);

  it('新增分类：名字不重、存储路径默认是根目录 + 分类名（图片 / 音效各自的根）', () => {
    const images = addAssetCategory(addAssetCategory(makeProject(), 'imageCategories'), 'imageCategories');
    expect(imageNames(images)).toEqual(['新分类', '新分类2']);
    expect(images.imageCategories[0].path).toBe('/Game/GameContent/Asset/Image/新分类');
    expect(images.imageCategories[1].path).toBe('/Game/GameContent/Asset/Image/新分类2');
    // 每条分类都有自己的 uid
    expect(images.imageCategories[0].uid).not.toBe(images.imageCategories[1].uid);

    const sounds = addAssetCategory(images, 'soundCategories');
    expect(soundNames(sounds)).toEqual(['新分类']);
    expect(sounds.soundCategories[0].path).toBe('/Game/GameContent/Asset/Sound/新分类');
  });

  it('改分类名：资源行存的是 uid，改名之后引用不断（图片、音效都一样）', () => {
    const project = makeProject();
    project.imageCategories = [{ uid: 'cat-1', name: '新分类', path: '' }];
    project.images = [{ uid: 'img-1', id: 'SCE_1', name: '', categoryUid: 'cat-1' }];
    project.soundCategories = [{ uid: 'snd-cat-1', name: '新分类', path: '' }];
    project.sounds = [{ uid: 'snd-1', id: 'S_1', name: '', categoryUid: 'snd-cat-1' }];

    const next = updateAssetCategory(project, 'imageCategories', 'cat-1', { name: '对话背景' });
    expect(next.imageCategories[0].name).toBe('对话背景');
    expect(next.images[0].categoryUid).toBe('cat-1');

    const soundNext = updateAssetCategory(next, 'soundCategories', 'snd-cat-1', { name: '背景音乐' });
    expect(soundNext.soundCategories[0].name).toBe('背景音乐');
    expect(soundNext.sounds[0].categoryUid).toBe('snd-cat-1');
  });

  it('存储路径还是默认值（根目录 + 老名字）时跟着分类名一起改，改过就不动', () => {
    const project = makeProject();
    project.imageCategories = [
      { uid: 'cat-1', name: '新分类', path: '/Game/GameContent/Asset/Image/新分类' },
      { uid: 'cat-2', name: 'CG', path: '/Game/Custom/CG' },
    ];

    const followed = updateAssetCategory(project, 'imageCategories', 'cat-1', { name: '对话背景' });
    expect(followed.imageCategories[0].path).toBe('/Game/GameContent/Asset/Image/对话背景');

    const kept = updateAssetCategory(followed, 'imageCategories', 'cat-2', { name: '过场' });
    expect(kept.imageCategories[1].path).toBe('/Game/Custom/CG');
  });

  it('删除分类：只删这一条，资源行留着 uid（交给校验条提醒）', () => {
    const project = makeProject();
    project.imageCategories = [
      { uid: 'cat-1', name: '对话背景', path: '/Game/A' },
      { uid: 'cat-2', name: 'CG', path: '/Game/B' },
    ];
    project.images = [{ uid: 'img-1', id: 'SCE_1', name: '', categoryUid: 'cat-1' }];

    const next = removeAssetCategory(project, 'imageCategories', 'cat-2');
    expect(imageNames(next)).toEqual(['对话背景']);
    expect(next.images[0].categoryUid).toBe('cat-1');
  });

  it('新增图片 / 音效默认选第一个分类；没有分类时留空', () => {
    const project = makeProject();
    project.imageCategories = [{ uid: 'cat-1', name: '对话背景', path: '/Game/A' }];
    project.soundCategories = [{ uid: 'snd-cat-1', name: '背景音乐', path: '/Game/S' }];

    const withImage = addLookupRow(project, 'images');
    expect(withImage.images[0]).toMatchObject({ id: 'SCE_1', categoryUid: 'cat-1' });

    const withSound = addLookupRow(withImage, 'sounds');
    expect(withSound.sounds[0]).toMatchObject({ id: 'S_1', categoryUid: 'snd-cat-1' });

    const empty = addLookupRow(addLookupRow(makeProject(), 'images'), 'sounds');
    expect(empty.images[0].categoryUid).toBe('');
    expect(empty.sounds[0].categoryUid).toBe('');
  });
});
