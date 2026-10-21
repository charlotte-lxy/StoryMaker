import { describe, expect, it } from 'vitest';

import {
  buildCommandText,
  buildPlayDialogueCommand,
  buildSpecialCommand,
  commandDefLabel,
  commandDefNote,
  findCommandDef,
  forbiddenCharOf,
  isReferenceSource,
  matchCommandText,
  paramValuesOf,
  parseCommandText,
  specialEffectNameOf,
} from './command-build';
import type { CommandDef, CommandParamDef, ParamSource } from './types';

function makeParam(
  name: string,
  source: ParamSource,
  over: Partial<CommandParamDef> = {},
): CommandParamDef {
  return { uid: name, name, source, options: [], required: true, note: '', ...over };
}

function makeDef(over: Partial<CommandDef> = {}): CommandDef {
  return {
    uid: 'd1',
    category: '指令',
    head: '剧情',
    branch: '演出',
    params: [
      makeParam('角色', 'character'),
      makeParam('表情', 'expression', { required: false }),
    ],
    note: '',
    ...over,
  };
}

describe('指令拼装', () => {
  it('主指令 | 分支 | 参数名:值', () => {
    expect(buildCommandText(makeDef(), { 角色: 'CHA_西园寺雪', 表情: '悲伤' })).toBe(
      '剧情|演出|角色:CHA_西园寺雪;表情:悲伤',
    );
  });

  it('空分支写成空段，非必填参数没填就整项省略', () => {
    const def = makeDef({
      head: '剧情',
      branch: '图片',
      params: [makeParam('图片', 'image', { required: false })],
    });
    expect(buildCommandText(def, {})).toBe('剧情|图片|');
    expect(buildCommandText(def, { 图片: 'SCE_1' })).toBe('剧情|图片|图片:SCE_1');
  });

  it('参数值就是运算符时不会和分隔符撞车（运算符:=）', () => {
    const def = makeDef({
      head: '背包',
      branch: '',
      params: [
        makeParam('物品', 'item'),
        makeParam('运算符', 'fixed', { options: ['+', '-', '='] }),
        makeParam('数量', 'number'),
      ],
    });
    expect(buildCommandText(def, { 物品: 'Item_Coin', 运算符: '=', 数量: '100' })).toBe(
      '背包||物品:Item_Coin;运算符:=;数量:100',
    );
  });

  it('参数值里的分隔符也算不合法（用 forbiddenCharOf 查）', () => {
    expect(forbiddenCharOf('a:;')).toBe(':');
    expect(forbiddenCharOf('数量')).toBeNull();
  });
});

describe('指令拆解', () => {
  it('拆出主指令、分支与参数', () => {
    expect(parseCommandText('剧情|演出|角色:CHA_西园寺雪;表情:悲伤')).toEqual({
      head: '剧情',
      branch: '演出',
      params: [
        { name: '角色', value: 'CHA_西园寺雪' },
        { name: '表情', value: '悲伤' },
      ],
    });
  });

  it('空段、无参数都能读', () => {
    expect(parseCommandText('背包||物品:Item_Coin;运算符:>=;数量:10')).toEqual({
      head: '背包',
      branch: '',
      params: [
        { name: '物品', value: 'Item_Coin' },
        { name: '运算符', value: '>=' },
        { name: '数量', value: '10' },
      ],
    });
    expect(parseCommandText('剧情|图片|')).toEqual({ head: '剧情', branch: '图片', params: [] });
  });

  it('值里允许出现等号（运算符 = 也能读回来）', () => {
    expect(parseCommandText('背包||物品:Item_Coin;运算符:=;数量:100')?.params).toContainEqual({
      name: '运算符',
      value: '=',
    });
  });

  it('格式不对返回 null', () => {
    expect(parseCommandText('')).toBeNull();
    expect(parseCommandText('剧情.演出# CHA_x.表情=悲伤')).toBeNull(); // 老格式
    expect(parseCommandText('剧情|演出|角色')).toBeNull(); // 参数少了冒号
    expect(parseCommandText('剧情|演出|角色:a|b')).toBeNull(); // 多出一个分隔符
  });

  it('参数摊成「参数名 → 值」方便回填控件', () => {
    expect(paramValuesOf(parseCommandText('特殊||特殊指令:SP_001'))).toEqual({
      特殊指令: 'SP_001',
    });
  });
});

describe('按主指令 + 分支找字典条目', () => {
  const defs: CommandDef[] = [
    makeDef({ uid: 'a', category: '指令', head: '剧情', branch: '演出' }),
    makeDef({ uid: 'b', category: '条件', head: '背包', branch: '' }),
  ];

  it('同一条文本在条件 / 指令里各找各的', () => {
    expect(findCommandDef(defs, '指令', '剧情', '演出')?.uid).toBe('a');
    expect(findCommandDef(defs, '条件', '剧情', '演出')).toBeUndefined();
    expect(findCommandDef(defs, '条件', '背包', '')?.uid).toBe('b');
  });

  it('从文本直接匹配', () => {
    expect(matchCommandText('剧情|演出|角色:x', defs, '指令')?.uid).toBe('a');
    expect(matchCommandText('剧情|演出|角色:x', defs, '条件')).toBeUndefined();
  });

  it('引用类参数才需要把 uid 翻成 ID', () => {
    expect(isReferenceSource('character')).toBe(true);
    expect(isReferenceSource('fixed')).toBe(false);
    expect(isReferenceSource('expression')).toBe(false);
  });
});

describe('跳转 / 特殊演出效果', () => {
  it('跳转到段落拼成「剧情|播放对话|对话:ID」', () => {
    expect(buildPlayDialogueCommand('Dia_ch01_002-1')).toBe('剧情|播放对话|对话:Dia_ch01_002-1');
  });

  it('特殊演出效果拼成「特殊||特殊指令:名称」，并且能取回来', () => {
    const text = buildSpecialCommand('SP_CameraShake');
    expect(text).toBe('特殊||特殊指令:SP_CameraShake');
    expect(specialEffectNameOf(text)).toBe('SP_CameraShake');
  });

  it('参数名可以跟着字典改', () => {
    const text = buildSpecialCommand('SP_001', '演出编号');
    expect(text).toBe('特殊||演出编号:SP_001');
    expect(specialEffectNameOf(text, '演出编号')).toBe('SP_001');
  });

  it('不是特殊指令时原样返回，好让人看见并改掉', () => {
    expect(specialEffectNameOf('剧情|图片|图片:SCE_1')).toBe('剧情|图片|图片:SCE_1');
  });
});

describe('字典条目的显示名', () => {
  it('有分支时「主指令 · 分支」，没分支只写主指令', () => {
    expect(commandDefLabel(makeDef())).toBe('剧情 · 演出');
    expect(commandDefLabel(makeDef({ head: '背包', branch: '' }))).toBe('背包');
  });

  it('完整说明带上备注', () => {
    expect(commandDefNote(makeDef({ note: '表情清单在角色表里配置' }))).toBe(
      '剧情 · 演出　—　表情清单在角色表里配置',
    );
  });
});
