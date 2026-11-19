import { describe, expect, it } from 'vitest';

import { CONTINUE_TARGET, firstLineRef } from './ids';
import {
  advance,
  chooseOption,
  continueToNextGroup,
  describeCommand,
  nextGroupUidOf,
  previewSpeakerName,
  restartGroup,
  startPreview,
  stepBack,
} from './preview';
import type { Line, Project, StoryOption } from './types';
import { createEmptyProject } from '../state/operations';

function dialogue(
  uid: string,
  readableId: string,
  zh: string,
  patch: Partial<Line> = {},
): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterUid: '',
    displayAliasUid: '',
    text: { zh, en: '', ja: '' },
    autoAdvance: false,
    command: '',
    specialContent: null,
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
    ...patch,
  };
}

function commandLine(uid: string, readableId: string, command: string): Line {
  return dialogue(uid, readableId, '', { kind: '指令', command });
}

function optionLine(uid: string, readableId: string, optionIds: string[]): Line {
  return dialogue(uid, readableId, '', { kind: '选项', optionIds });
}

function option(uid: string, readableId: string, zh: string, nextId: string): StoryOption {
  return {
    uid,
    readableId,
    text: { zh, en: '', ja: '' },
    nextId,
    appearConditions: [],
    enableConditions: [],
  };
}

/**
 * 一章两个段落：g1 放给定的行，g2 固定一句「海风很大」。
 * 默认项目自带字典，指令直接用默认里的写法。
 */
function makeProject(lines: Line[], options: StoryOption[] = []): Project {
  const project = createEmptyProject('预览测试');
  project.chapters = [
    {
      uid: 'c1',
      id: 'ch01',
      title: '序章',
      groups: [
        { uid: 'g1', id: '001', title: '开场', note: '', lines, options },
        {
          uid: 'g2',
          id: '002',
          title: '码头',
          note: '',
          lines: [dialogue('d9', 'Dia_ch01_002-1', '海风很大')],
          options: [],
        },
      ],
    },
  ];
  return project;
}

function addCharacter(project: Project, uid: string, id: string, name: string): void {
  project.characters.push({
    uid,
    id,
    name,
    nameEn: '',
    nameJa: '',
    playPosition: project.playPositions[0]?.uid ?? '',
    aliases: [],
    expressions: ['微笑', '悲伤'],
    actions: ['挥手'],
  });
}

describe('startPreview / advance', () => {
  it('逐条展示对话，念完停在段落末尾并给下一段', () => {
    const project = makeProject([
      dialogue('d1', 'Dia_ch01_001-1', '第一句'),
      dialogue('d2', 'Dia_ch01_001-2', '第二句'),
    ]);

    const first = startPreview(project, { groupUid: 'g1' });
    expect(first.status).toBe('line');
    expect(first.current?.text.zh).toBe('第一句');
    expect(first.stage.characters).toEqual([]);

    const second = advance(project, first);
    expect(second.status).toBe('line');
    expect(second.current?.text.zh).toBe('第二句');

    const end = advance(project, second);
    expect(end.status).toBe('finished');
    expect(end.current).toBeNull();
    expect(end.nextGroupUid).toBe('g2');
  });

  it('从指定行开始', () => {
    const project = makeProject([
      dialogue('d1', 'Dia_ch01_001-1', '第一句'),
      dialogue('d2', 'Dia_ch01_001-2', '第二句'),
    ]);

    const state = startPreview(project, { groupUid: 'g1', lineUid: 'd2' });
    expect(state.current?.lineUid).toBe('d2');
  });

  it('上一句退回上一个停住的地方', () => {
    const project = makeProject([
      dialogue('d1', 'Dia_ch01_001-1', '第一句'),
      dialogue('d2', 'Dia_ch01_001-2', '第二句'),
    ]);

    const first = startPreview(project, { groupUid: 'g1' });
    const second = advance(project, first);
    const back = stepBack(second);
    expect(back.current?.text.zh).toBe('第一句');
    expect(back.history).toHaveLength(0);
  });
});

describe('选项跳转', () => {
  it('「继续对话」接到下一行', () => {
    const project = makeProject(
      [
        optionLine('l1', 'Dia_ch01_001-1', ['o1']),
        dialogue('d2', 'Dia_ch01_001-2', '接着说'),
      ],
      [option('o1', 'Dia_ch01_001-1A', '继续', CONTINUE_TARGET)],
    );

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.status).toBe('options');
    expect(state.options[0].text.zh).toBe('继续');

    const after = chooseOption(project, state, 'o1');
    expect(after.current?.text.zh).toBe('接着说');
  });

  it('跳到指定对话 / 首句 / 结尾', () => {
    const project = makeProject(
      [
        optionLine('l1', 'Dia_ch01_001-1', ['o1', 'o2', 'o3']),
        dialogue('d2', 'Dia_ch01_001-2', '不去'),
      ],
      [
        option('o1', 'Dia_ch01_001-1A', '去码头', 'd9'),
        option('o2', 'Dia_ch01_001-1B', '跳首句', firstLineRef('g2')),
        option('o3', 'Dia_ch01_001-1C', '结束', ''),
      ],
    );

    const state = startPreview(project, { groupUid: 'g1' });

    expect(chooseOption(project, state, 'o1').current?.text.zh).toBe('海风很大');
    expect(chooseOption(project, state, 'o2').current?.text.zh).toBe('海风很大');

    const ended = chooseOption(project, state, 'o3');
    expect(ended.status).toBe('finished');
    expect(ended.log.at(-1)?.text).toContain('播放结束');
  });

  it('选项下一句不在了就结束并说明', () => {
    const project = makeProject(
      [optionLine('l1', 'Dia_ch01_001-1', ['o1'])],
      [option('o1', 'Dia_ch01_001-1A', '悬空', 'uid-不存在')],
    );

    const state = chooseOption(project, startPreview(project, { groupUid: 'g1' }), 'o1');
    expect(state.status).toBe('finished');
    expect(state.log.at(-1)?.text).toContain('不在项目里');
  });
});

describe('跳转到段落', () => {
  it('跳到段落第一句，并说明条件不判定', () => {
    const jump: Line = dialogue('l1', 'Dia_ch01_001-1', '', {
      kind: '指令',
      jumpGroupUid: 'g2',
      jumpConditions: ['背包||物品:Item_Coin;运算符:>=;数量:10'],
    });
    const project = makeProject([jump]);

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.current?.text.zh).toBe('海风很大');
    const log = state.log.map((entry) => entry.text).join('\n');
    expect(log).toContain('跳转到段落「码头」');
    expect(log).toContain('可用条件 1 条');
  });
});

describe('剧情|演出', () => {
  it('角色上场、换表情、退场', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|演出|角色:cha1;立绘位移:进入;表情:微笑'),
      dialogue('l2', 'Dia_ch01_001-2', '你好', { characterUid: 'cha1' }),
      commandLine('l3', 'Dia_ch01_001-3', '剧情|演出|角色:cha1;表情:悲伤'),
      commandLine('l4', 'Dia_ch01_001-4', '剧情|演出|角色:cha1;立绘位移:退出'),
      dialogue('l5', 'Dia_ch01_001-5', '再见', { characterUid: 'cha1' }),
    ]);
    addCharacter(project, 'cha1', 'CHA_雪', '西园寺雪');

    const first = startPreview(project, { groupUid: 'g1' });
    expect(first.current?.text.zh).toBe('你好');
    expect(first.stage.characters).toHaveLength(1);
    expect(first.stage.characters[0]).toMatchObject({
      characterUid: 'cha1',
      expression: '微笑',
      entered: true,
      slot: 0,
    });
    expect(previewSpeakerName(project, 'cha1', '')).toBe('西园寺雪');

    // 一次推进跨过「换表情」和「退出」两条指令，停在再下一句台词上
    const goodbye = advance(project, first);
    expect(goodbye.current?.text.zh).toBe('再见');
    expect(goodbye.stage.characters[0]).toMatchObject({
      expression: '悲伤',
      entered: false,
    });
  });

  it('没写「进入」也自动上场，并记一条提示', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|演出|角色:cha1;表情:微笑'),
      dialogue('l2', 'Dia_ch01_001-2', '你好', { characterUid: 'cha1' }),
    ]);
    addCharacter(project, 'cha1', 'CHA_雪', '西园寺雪');

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.stage.characters[0].entered).toBe(true);
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('自动上场');
  });

  it('角色已经退场时再退出，只提示不报错', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|演出|角色:cha1;立绘位移:退出'),
      dialogue('l2', 'Dia_ch01_001-2', '嗨', { characterUid: 'cha1' }),
    ]);
    addCharacter(project, 'cha1', 'CHA_雪', '西园寺雪');

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.status).toBe('line');
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('还没上场');
  });
});

describe('画面与声音指令', () => {
  it('图片：显示与清掉', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|图片|图片:img1'),
      dialogue('l2', 'Dia_ch01_001-2', '有背景'),
      commandLine('l3', 'Dia_ch01_001-3', '剧情|图片|'),
      dialogue('l4', 'Dia_ch01_001-4', '没背景'),
    ]);
    project.images.push({ uid: 'img1', id: 'PIC_海边', name: '海边' });

    const shown = startPreview(project, { groupUid: 'g1' });
    expect(shown.stage.backgroundImageUid).toBe('img1');

    const cleared = advance(project, shown);
    expect(cleared.stage.backgroundImageUid).toBe('');
  });

  it('CG 只把号摆出来', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|CG|CG:CG_Test_01'),
      dialogue('l2', 'Dia_ch01_001-2', '看 CG'),
    ]);

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.stage.cgId).toBe('CG_Test_01');
  });

  it('音效在日志里带 soundUid', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|音效|音效:snd1'),
      dialogue('l2', 'Dia_ch01_001-2', '有声音'),
    ]);
    project.sounds.push({ uid: 'snd1', id: 'S_风', name: '风声' });

    const state = startPreview(project, { groupUid: 'g1' });
    const played = state.log.filter((entry) => entry.soundUid !== undefined);
    expect(played).toHaveLength(1);
    expect(played[0].soundUid).toBe('snd1');
  });
});

describe('延时', () => {
  it('停下来等秒数，点继续后往下播', () => {
    const project = makeProject([
      dialogue('d1', 'Dia_ch01_001-1', '等一下'),
      commandLine('l2', 'Dia_ch01_001-2', '其他|延时|时长:0.5'),
      dialogue('d3', 'Dia_ch01_001-3', '好了'),
    ]);

    const waiting = advance(project, startPreview(project, { groupUid: 'g1' }));
    expect(waiting.status).toBe('delay');
    expect(waiting.delaySeconds).toBe(0.5);

    const after = advance(project, waiting);
    expect(after.status).toBe('line');
    expect(after.current?.text.zh).toBe('好了');
  });

  it('秒数不合法就跳过', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '其他|延时|时长:abc'),
      dialogue('d2', 'Dia_ch01_001-2', '照常播'),
    ]);

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.current?.text.zh).toBe('照常播');
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('不合法');
  });
});

describe('段落衔接', () => {
  it('继续下一段保留舞台和日志', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|演出|角色:cha1;立绘位移:进入'),
      dialogue('l2', 'Dia_ch01_001-2', '完'),
    ]);
    addCharacter(project, 'cha1', 'CHA_雪', '西园寺雪');

    const finished = advance(project, startPreview(project, { groupUid: 'g1' }));
    expect(finished.status).toBe('finished');

    const next = continueToNextGroup(project, finished);
    expect(next.current?.text.zh).toBe('海风很大');
    expect(next.stage.characters[0].entered).toBe(true);
    expect(next.log.map((entry) => entry.text).join('\n')).toContain('进入段落「码头」');
  });

  it('重播本段从头开始', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|演出|角色:cha1;立绘位移:进入'),
      dialogue('l2', 'Dia_ch01_001-2', '完'),
    ]);
    addCharacter(project, 'cha1', 'CHA_雪', '西园寺雪');

    const played = advance(project, startPreview(project, { groupUid: 'g1' }));
    expect(played.status).toBe('finished');

    const restarted = restartGroup(project, played);
    expect(restarted.current?.text.zh).toBe('完');
    expect(restarted.history).toHaveLength(0);
  });
});

describe('异常与兜底', () => {
  it('播放对话绕成环时停下，不卡死', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '剧情|播放对话|对话:l1'),
    ]);

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.status).toBe('blocked');
    expect(state.log.at(-1)?.text).toContain('绕成了环');
  });

  it('字典里没有的指令只记一笔，不中断', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '背包||物品:item1;运算符:+;数量:10'),
      dialogue('d2', 'Dia_ch01_001-2', '接着演'),
    ]);
    project.items.push({ uid: 'item1', id: 'Item_Coin', name: '金币' });

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.current?.text.zh).toBe('接着演');
    expect(state.log.map((entry) => entry.text).join('\n')).toContain('已忽略');
  });

  it('指令格式不对时记警告', () => {
    const project = makeProject([
      commandLine('l1', 'Dia_ch01_001-1', '这不是一条指令'),
      dialogue('d2', 'Dia_ch01_001-2', '继续'),
    ]);

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.log.some((entry) => entry.level === 'warn')).toBe(true);
    expect(state.current?.text.zh).toBe('继续');
  });
});

describe('describeCommand', () => {
  it('把指令里的 uid 翻成可读 ID', () => {
    const project = makeProject([]);
    project.items.push({ uid: 'item1', id: 'Item_Coin', name: '金币' });

    expect(
      describeCommand(project, '背包||物品:item1;运算符:>=;数量:10', '条件'),
    ).toBe('背包｜物品 Item_Coin，运算符 >=，数量 10');
  });

  it('字典里没有时原样输出', () => {
    const project = makeProject([]);
    expect(describeCommand(project, '乱写|的|', '指令')).toBe('乱写 · 的');
  });
});

describe('nextGroupUidOf', () => {
  it('同章下一段；最后一段为空', () => {
    const project = makeProject([]);
    expect(nextGroupUidOf(project, 'g1')).toBe('g2');
    expect(nextGroupUidOf(project, 'g2')).toBe('');
  });
});

describe('选项条件原文', () => {
  it('选项带着出现 / 可用条件，交给界面显示', () => {
    const project = makeProject(
      [optionLine('l1', 'Dia_ch01_001-1', ['o1'])],
      [
        {
          ...option('o1', 'Dia_ch01_001-1A', '要钱', CONTINUE_TARGET),
          appearConditions: ['背包||物品:Item_Coin;运算符:>=;数量:10'],
          enableConditions: ['任务||任务:Task_1;运算符:=;结果:1'],
        },
      ],
    );

    const state = startPreview(project, { groupUid: 'g1' });
    expect(state.options[0].appearConditions).toHaveLength(1);
    expect(state.options[0].enableConditions).toHaveLength(1);
  });
});
