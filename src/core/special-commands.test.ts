import { describe, expect, it } from 'vitest';

import { buildSpecialCommandRows, specialCommandClassName } from './special-commands';
import { createEmptyProject } from '../state/operations';
import type { Line, Project, StoryOption } from './types';

function makeLine(over: Partial<Line> = {}): Line {
  return {
    uid: 'l1',
    readableId: 'Dia_ch01_001-1',
    kind: '指令',
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
    ...over,
  };
}

function makeOption(over: Partial<StoryOption> = {}): StoryOption {
  return {
    uid: 'o1',
    readableId: 'Dia_ch01_001-1A',
    text: { zh: '', en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
    results: [],
    ...over,
  };
}

/** 段落 001：两条特殊指令（其中一条是「特殊演出效果」行）+ 一条普通指令 */
function makeProject(): Project {
  const project = createEmptyProject();
  const group = project.chapters[0].groups[0];
  group.lines = [
    makeLine({ uid: 'a1', command: '特殊# SP_001' }),
    makeLine({
      uid: 'a2',
      command: '剧情.演出# CHA_伊芙.表情=开心',
    }),
    makeLine({ uid: 'a3', command: '特殊# SP_CameraShake', specialContent: '屏幕震一下' }),
    // 同名再来一次：行只留一条，备注取第一条非空的
    makeLine({ uid: 'a4', command: '特殊# SP_001', specialContent: '第二次写的内容' }),
  ];
  return project;
}

describe('「特殊指令」子表', () => {
  it('表头是 行名 / Command类 / 备注', () => {
    expect(buildSpecialCommandRows(createEmptyProject())[0]).toEqual(['', 'Command类', '备注']);
  });

  it('没有特殊指令时只有表头，不写半截行', () => {
    expect(buildSpecialCommandRows(createEmptyProject())).toHaveLength(1);
  });

  it('只收「特殊#」开头的指令，一行一条、按第一次出现的顺序', () => {
    const rows = buildSpecialCommandRows(makeProject());
    expect(rows.slice(1).map((row) => row[0])).toEqual(['SP_001', 'SP_CameraShake']);
  });

  it('Command类 = 前缀 + BP_Command_行名', () => {
    const project = makeProject();
    const rows = buildSpecialCommandRows(project);
    expect(rows[1][1]).toBe(
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/ComponentBase/Command/SpeciesCommand/BP_Command_SP_001.BP_Command_SP_001_C'",
    );
    // 前缀在界面上改得动，导出跟着变
    project.specialCommandClassPrefix = "/Script/Engine.BlueprintGeneratedClass'/Game/BP/Cmd/";
    expect(buildSpecialCommandRows(project)[1][1]).toBe(
      "/Script/Engine.BlueprintGeneratedClass'/Game/BP/Cmd/BP_Command_SP_001.BP_Command_SP_001_C'",
    );
  });

  it('备注取「特殊演出效果」行填的指令内容，同名只留第一条非空的', () => {
    const rows = buildSpecialCommandRows(makeProject());
    expect(rows[1][2]).toBe('第二次写的内容'); // 第一条同名行没填内容，落到第二条
    expect(rows[2][2]).toBe('屏幕震一下');
  });

  it('普通「指令」行里手写的特殊指令也收，没有指令内容就留空备注', () => {
    const project = createEmptyProject();
    project.chapters[0].groups[0].lines = [makeLine({ command: '特殊# SP_Only' })];
    expect(buildSpecialCommandRows(project)[1]).toEqual([
      'SP_Only',
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/ComponentBase/Command/SpeciesCommand/BP_Command_SP_Only.BP_Command_SP_Only_C'",
      '',
    ]);
  });

  it('选项的结果里出现的特殊指令同样收进来', () => {
    const project = createEmptyProject();
    const group = project.chapters[0].groups[0];
    group.lines = [makeLine({ kind: '选项', optionIds: ['o1'] })];
    group.options = [makeOption({ results: ['特殊# SP_FromOption', '背包# Item_Coin+1'] })];

    const rows = buildSpecialCommandRows(project);
    expect(rows.slice(1).map((row) => row[0])).toEqual(['SP_FromOption']);
  });

  it('「跳转到段落」行不算：它的指令是按段落现拼的', () => {
    const project = createEmptyProject();
    project.chapters[0].groups[0].lines = [
      makeLine({ kind: '指令', jumpGroupUid: 'g1', command: '特殊# SP_不该收' }),
    ];
    expect(buildSpecialCommandRows(project)).toHaveLength(1);
  });

  it('指令名是空的、或只有「特殊#」时不凑一行', () => {
    const project = createEmptyProject();
    project.chapters[0].groups[0].lines = [
      makeLine({ command: '特殊#' }),
      makeLine({ command: '特殊#   ' }),
    ];
    expect(buildSpecialCommandRows(project)).toHaveLength(1);
  });

  it('类名固定是 BP_Command_ 开头', () => {
    expect(specialCommandClassName('SP_001')).toBe('BP_Command_SP_001');
  });
});
