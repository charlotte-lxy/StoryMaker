import { describe, expect, it } from 'vitest';

import { buildCommand, commandDefLabel, commandDefNote, matchCommandDef } from './command-build';
import type { CommandDef } from './types';

function makeDef(over: Partial<CommandDef> = {}): CommandDef {
  return {
    uid: 'd1',
    category: '指令',
    head: '剧情.演出',
    branch: '',
    target: 'character',
    attribute: '',
    operator: '',
    value: 'none',
    fixedValues: [],
    note: '',
    ...over,
  };
}

describe('指令拼装', () => {
  it('分类名不参与拼装（回归：曾拼成 剧情.演出.设置表情# …）', () => {
    const def = makeDef({ branch: '设置表情', attribute: '表情', operator: '=', value: 'expression' });
    expect(buildCommand(def, 'CHA_宫本奈奈', '开心')).toBe('剧情.演出# CHA_宫本奈奈.表情=开心');
  });

  it('立绘进入', () => {
    const def = makeDef({ branch: '立绘进入', attribute: '进入', operator: '=', value: 'fixed' });
    expect(buildCommand(def, 'CHA_西园寺雪', '1')).toBe('剧情.演出# CHA_西园寺雪.进入=1');
  });

  it('指令头自带点号时不被改写', () => {
    const def = makeDef({ head: '任务.接取', branch: '获得任务', target: 'quest' });
    expect(buildCommand(def, 'Task_Test_01', '')).toBe('任务.接取# Task_Test_01');
  });

  it('无目标、无属性的形式', () => {
    const def = makeDef({ head: '特殊', branch: '', target: 'manual' });
    expect(buildCommand(def, 'SP_001', '')).toBe('特殊# SP_001');
  });

  it('条件也走同一套拼装', () => {
    const def = makeDef({
      category: '条件',
      head: '背包',
      target: 'item',
      operator: '>=',
      value: 'number',
    });
    expect(buildCommand(def, 'Item_Coin', '10')).toBe('背包# Item_Coin>=10');
  });
});

describe('字典条目的显示名', () => {
  it('下拉里的名字要短，避免把下拉撑宽', () => {
    const def = makeDef({ branch: '设置表情', attribute: '表情', note: '表情清单在角色表里配置' });
    expect(commandDefLabel(def)).toBe('设置表情 · 表情');
    expect(commandDefNote(def)).toBe('剧情.演出　—　表情清单在角色表里配置');
  });

  it('没有属性时退回用运算符区分', () => {
    expect(commandDefLabel(makeDef({ head: '背包', operator: '>=' }))).toBe('背包 · >=');
    expect(commandDefLabel(makeDef({ head: '背包', operator: '+' }))).toBe('背包 · +');
  });

  it('都没有时只用分类名或指令头', () => {
    expect(commandDefLabel(makeDef({ head: '特殊' }))).toBe('特殊');
    expect(commandDefLabel(makeDef({ head: '任务.接取', branch: '获得任务' }))).toBe('获得任务');
  });
});

describe('指令回匹配字典', () => {
  const defs: CommandDef[] = [
    makeDef({ uid: 'a', category: '条件', head: '背包', operator: '>=', value: 'number' }),
    makeDef({ uid: 'b', category: '指令', head: '背包', operator: '+', value: 'number' }),
    makeDef({ uid: 'c', head: '剧情.演出', attribute: '表情', operator: '=', value: 'expression' }),
    makeDef({ uid: 'd', head: '剧情.演出', attribute: '进入', operator: '=', value: 'fixed' }),
  ];

  it('同一指令头下靠运算符区分条件与指令', () => {
    const cond = matchCommandDef(
      { name: '背包', branch: '', operator: '>=', attribute: '' },
      defs,
    );
    expect(cond?.uid).toBe('a');
    expect(cond?.category).toBe('条件');

    const cmd = matchCommandDef({ name: '背包', branch: '', operator: '+', attribute: '' }, defs);
    expect(cmd?.uid).toBe('b');
    expect(cmd?.category).toBe('指令');
  });

  it('同一指令头下靠属性区分表情与进入', () => {
    expect(
      matchCommandDef({ name: '剧情', branch: '演出', operator: '=', attribute: '表情' }, defs)?.uid,
    ).toBe('c');
    expect(
      matchCommandDef({ name: '剧情', branch: '演出', operator: '=', attribute: '进入' }, defs)?.uid,
    ).toBe('d');
  });
});
