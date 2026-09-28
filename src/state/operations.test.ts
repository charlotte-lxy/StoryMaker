import { describe, expect, it } from 'vitest';

import { createEmptyBattle } from '../core/battle';

import type { Line, Project } from '../core/types';
import {
  addUiText,
  collectGroupedLineRefs,
  groupUidOfLine,
  insertLine,
  parseCommand,
  removeUiText,
  renumberOneGroup,
  reorderLine,
  updateTextByUid,
  updateUiText,
} from './operations';

function makeLine(uid: string, readableId: string, zh: string): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterId: '',
    displayName: '',
    text: { zh, en: '', ja: '' },
    autoAdvance: false,
    command: '',
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

describe('指令解析（样例里的三种形态）', () => {
  it('完整形式：指令名.分支# 对象.属性 运算符 结果', () => {
    expect(parseCommand('剧情.人物# CHA_Q版伊芙.差分 = 挥手')).toEqual({
      name: '剧情',
      branch: '人物',
      target: 'CHA_Q版伊芙',
      attribute: '差分',
      operator: '=',
      value: '挥手',
    });
  });

  it('省略属性与结果：只有前三段', () => {
    expect(parseCommand('剧情.特殊# SP_ch01_001')).toEqual({
      name: '剧情',
      branch: '特殊',
      target: 'SP_ch01_001',
      attribute: '',
      operator: '',
      value: '',
    });
  });

  it('有运算符但没有属性', () => {
    expect(parseCommand('剧情.音效# S_dididi = 1')).toEqual({
      name: '剧情',
      branch: '音效',
      target: 'S_dididi',
      attribute: '',
      operator: '=',
      value: '1',
    });
  });

  it('不符合通用格式时返回 null，界面会标黄提示', () => {
    expect(parseCommand('随便一段文字')).toBeNull();
    expect(parseCommand('缺少分隔符')).toBeNull();
  });

  it('主指令没有分支段时也能解析（点号可省略）', () => {
    expect(parseCommand('背包# Like_西园寺雪+1')).toEqual({
      name: '背包',
      branch: '',
      target: 'Like_西园寺雪',
      attribute: '',
      operator: '+',
      value: '1',
    });
    expect(parseCommand('特殊# SP_001')).toEqual({
      name: '特殊',
      branch: '',
      target: 'SP_001',
      attribute: '',
      operator: '',
      value: '',
    });
  });
});
