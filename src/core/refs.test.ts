import { describe, expect, it } from 'vitest';

import { buildBattleRows } from './battle-export';
import { validateBattle } from './battle-validate';
import { createEmptyBattle } from './battle';
import { parseArrayLiteral } from './array-literal';
import { buildRows } from './export';
import { normalizeProject } from './migrate';
import { collectRefMaps, translateTarget } from './refs';
import type { BattleData, Line, Project } from './types';
import { parseCommand } from '../state/operations';
import { validateProject } from './validate';

/**
 * 引用的规矩：**软件内部一律存 uid，导出那一刻才翻成可读 ID / 名字。**
 *
 * 这组用例要证的就是这件事：改角色 ID、改物品 ID、改属性名、改技能名之后，
 * 引用不会断，而且导出结果是跟着新名字走的（不是留在旧名字上）。
 */

function line(uid: string, readableId: string, over: Partial<Line> = {}): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterUid: '',
    displayAliasUid: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    command: '',
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
    ...over,
  };
}

function makeBattle(): BattleData {
  const battle = createEmptyBattle();
  battle.attributes = [{ uid: 'a1', name: '生命值', note: '', tagNote: '' }];
  battle.events = [{ uid: 'v1', name: '受击', note: '', tagNote: '' }];
  battle.effects = [
    {
      uid: 'e1',
      name: '中毒',
      note: '',
      className: 'BP_GameEffect_Base',
      duration: '10',
      period: '1',
      periodImmediate: false,
      reduceStacks: '1',
      maxStacks: '5',
      refreshDuration: false,
      refreshPeriod: false,
      // 属性那一格是 uid
      modifiers: [{ uid: 'm1', duration: '基础', attributeUid: 'a1', operator: '-', value: 'Damage' }],
      tagNote: '',
    },
  ];
  battle.skills = [
    {
      uid: 's1',
      name: '回血',
      className: 'BP_GA_Heal',
      lockSkillUids: [],
      listenEventUids: [],
      parameters: [],
      tagNote: '',
    },
    {
      uid: 's2',
      name: '加速',
      className: 'BP_GA_IncreaseSpeed',
      lockSkillUids: ['s1'],
      listenEventUids: ['v1'],
      parameters: [],
      tagNote: '',
    },
  ];
  battle.characters = [
    {
      uid: 'bc1',
      id: 'CHA_测试主角',
      name: '测试主角',
      // 属性列表的 key 是属性 uid
      attributes: [{ uid: 'p1', key: 'a1', value: '100' }],
      skillUids: ['s1'],
    },
  ];
  return battle;
}

function makeProject(): Project {
  return {
    version: 1,
    name: '引用测试',
    characters: [
      { uid: 'ch1', id: 'CHA_伊芙', name: '伊芙', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: ['微笑'], actions: ['挥手'] },
    ],
    items: [{ uid: 'it1', id: 'Item_Coin', name: '金币' }],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    variables: [],
    uiTexts: [],
    battle: makeBattle(),
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
              line('l1', 'Dia_ch01_001-1', {
                characterUid: 'ch1',
                text: { zh: '你好', en: '', ja: '' },
              }),
              // 指令里的目标也是 uid：演出对象是角色，背包里是物品
              line('l2', 'Dia_ch01_001-2', { kind: '指令', command: '剧情.演出# ch1.表情=挥手' }),
              line('l3', 'Dia_ch01_001-3', { kind: '指令', command: '背包# it1 >= 10' }),
            ],
            options: [],
          },
        ],
      },
    ],
  };
}

/** 导出以后某一行的某一列 */
function cell(rows: string[][], id: string, column: number): string {
  const row = rows.find((item) => item[0] === id);
  if (row === undefined) throw new Error(`导出结果里没有 ${id}`);
  return row[column] ?? '';
}

describe('改 ID 之后引用不断', () => {
  it('对话行的角色：改角色 ID，导出跟着写新 ID；校验依然干净', () => {
    const project = makeProject();
    const before = buildRows(project);
    expect(cell(before.dialogue, 'Dia_ch01_001-1', 2)).toBe('CHA_伊芙');

    // 把角色表里那一行的 ID 改掉：引用按 uid 找，所以一个字都不用跟着改
    project.characters[0].id = 'CHA_伊芙_新版';
    project.characters[0].name = '伊芙（新）';

    const after = buildRows(project);
    expect(cell(after.dialogue, 'Dia_ch01_001-1', 2)).toBe('CHA_伊芙_新版');
    expect(validateProject(project).issues).toEqual([]);
  });

  it('指令里的目标：改角色 ID 与物品 ID，指令文本导出时跟着翻成新 ID', () => {
    const project = makeProject();
    project.characters[0].id = 'CHA_新名字';
    project.items[0].id = 'Item_Gold';

    const rows = buildRows(project);

    // 存进去的是 uid，导出的必须是可读 ID
    expect(parseArrayLiteral(cell(rows.dialogue, 'Dia_ch01_001-2', 7))).toEqual([
      '剧情.演出# CHA_新名字.表情=挥手',
    ]);
    expect(parseArrayLiteral(cell(rows.dialogue, 'Dia_ch01_001-3', 7))).toEqual([
      '背包# Item_Gold >= 10',
    ]);
    expect(validateProject(project).issues).toEqual([]);
  });

  it('战斗表：改属性名 / 技能名 / 事件名，导出与校验都跟着新的走', () => {
    const project = makeProject();
    expect(cell(buildBattleRows(project).effects, 'GAS.效果.中毒', 10)).toBe('("基础#生命值-Damage")');

    project.battle.attributes[0].name = '血量';
    project.battle.skills[0].name = '治疗';
    project.battle.events[0].name = '被打';

    const battle = buildBattleRows(project);
    expect(cell(battle.effects, 'GAS.效果.中毒', 10)).toBe('("基础#血量-Damage")');
    expect(cell(battle.characters, 'CHA_测试主角', 2)).toBe('(("GAS.属性.血量","100"))');
    // s2 锁定的技能、监听的事件也按新名字合成 Tag
    expect(cell(battle.skills, 'GAS.技能.加速', 2)).toBe('("GAS.技能.治疗")');
    expect(cell(battle.skills, 'GAS.技能.加速', 3)).toBe('("GAS.事件.被打")');
    // 名字改完引用还都指得着，一条问题都不该有
    expect(validateBattle(project).issues).toEqual([]);
  });

  it('改可读 ID（对话 ID）也不影响任何引用', () => {
    const project = makeProject();
    project.chapters[0].groups[0].lines[0].readableId = 'Dia_ch01_001-99';
    const rows = buildRows(project);
    // 引用按 uid 找，改的是被引用者自己的 ID：角色引用不受影响
    expect(cell(rows.dialogue, 'Dia_ch01_001-99', 2)).toBe('CHA_伊芙');
  });
});

describe('uid 与可读 ID 的翻译', () => {
  it('指令文本里的目标按 # 后面那一截翻译，uid 里的 - 不会被当成减号', () => {
    const maps = collectRefMaps(makeProject());
    expect(maps.byUid.get('it1')).toBe('Item_Coin');
    expect(maps.byId.get('Item_Coin')).toBe('it1');
    expect(translateTarget('背包# it1 >= 10', maps.byUid)).toBe('背包# Item_Coin >= 10');
    expect(translateTarget('背包# Item_Coin >= 10', maps.byId)).toBe('背包# it1 >= 10');
    // 认不出来的目标原样留着，不把文本改坏
    expect(translateTarget('特殊# SP_001', maps.byId)).toBe('特殊# SP_001');
  });

  it('解析指令时先把已知 uid 切出来，剩下的才算运算符', () => {
    const uid = '3f2a1b4c-0000-4000-8000-000000000000';
    const isUid = (value: string): boolean => value === uid;

    expect(parseCommand(`剧情.演出# ${uid}.表情=挥手`, isUid)).toEqual({
      name: '剧情',
      branch: '演出',
      target: uid,
      attribute: '表情',
      operator: '=',
      value: '挥手',
    });
    expect(parseCommand(`背包# ${uid}>=10`, isUid)).toEqual({
      name: '背包',
      branch: '',
      target: uid,
      attribute: '',
      operator: '>=',
      value: '10',
    });
    // 手写的 ID / 名字照旧走正则
    expect(parseCommand('背包# Item_Coin >= 10')?.target).toBe('Item_Coin');
  });
});

describe('读老项目时把引用换成 uid', () => {
  it('按角色 ID / 属性名 / 技能名 / 物品 ID 写的引用都会换成 uid', () => {
    const result = normalizeProject({
      version: 1,
      name: '老项目',
      characters: [{ uid: 'ch1', id: 'CHA_伊芙', name: '伊芙' }],
      items: [{ uid: 'it1', id: 'Item_Coin', name: '金币' }],
      quests: [],
      images: [],
      sounds: [],
      commands: [],
      variables: [],
      battle: {
        attributes: [{ uid: 'a1', name: '生命值' }],
        events: [{ uid: 'v1', name: '受击' }],
        effects: [
          {
            uid: 'e1',
            name: '中毒',
            // 老字段：存的是属性名
            modifiers: [{ uid: 'm1', duration: '基础', attribute: '生命值', operator: '-', value: 'Damage' }],
          },
        ],
        skills: [
          { uid: 's1', name: '回血' },
          { uid: 's2', name: '加速', lockSkills: ['回血'], listenEvents: ['受击'] },
        ],
        characters: [{ uid: 'bc1', id: 'CHA_主角', attributes: [{ uid: 'p1', key: '生命值', value: '100' }] }],
        weapons: [],
      },
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
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '对话',
                  characterId: 'CHA_伊芙',
                  text: { zh: '你好' },
                },
                {
                  uid: 'l2',
                  readableId: 'Dia_ch01_001-2',
                  kind: '指令',
                  // 指令文本里的目标也按 ID 换成 uid
                  command: '剧情.演出# CHA_伊芙.表情=挥手',
                },
              ],
              options: [],
            },
          ],
        },
      ],
    });

    const project = result!.project;
    const lines = project.chapters[0].groups[0].lines;
    expect(lines[0].characterUid).toBe('ch1');
    expect(lines[1].command).toBe('剧情.演出# ch1.表情=挥手');
    expect(project.battle.effects[0].modifiers[0].attributeUid).toBe('a1');
    expect(project.battle.skills[1].lockSkillUids).toEqual(['s1']);
    expect(project.battle.skills[1].listenEventUids).toEqual(['v1']);
    expect(project.battle.characters[0].attributes[0].key).toBe('a1');
    // 换完再导出，跟老项目原来的写法一模一样
    expect(cell(buildRows(project).dialogue, 'Dia_ch01_001-2', 7)).toBe(
      '("剧情.演出# CHA_伊芙.表情=挥手")',
    );
  });

  it('表里找不到的引用原样保留，交给校验条去说', () => {
    const result = normalizeProject({
      version: 1,
      name: '老项目',
      characters: [],
      items: [],
      quests: [],
      images: [],
      sounds: [],
      commands: [],
      variables: [],
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
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '对话',
                  characterId: 'CHA_还没建',
                  text: { zh: '你好' },
                },
              ],
              options: [],
            },
          ],
        },
      ],
    });

    const project = result!.project;
    expect(project.chapters[0].groups[0].lines[0].characterUid).toBe('CHA_还没建');
    // 导出照样写这个 ID，跟改之前一样
    expect(cell(buildRows(project).dialogue, 'Dia_ch01_001-1', 2)).toBe('CHA_还没建');
    // 只是提醒一句，不算必须修复
    expect(validateProject(project).issues.map((item) => item.code)).toEqual(['unknown-character']);
  });
});
