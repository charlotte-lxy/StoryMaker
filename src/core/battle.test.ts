import { describe, expect, it } from 'vitest';

import {
  attributeTag,
  classPath,
  collectGameplayTags,
  createEmptyBattle,
  effectTag,
  eventTag,
  formatPairLiteral,
  modifierText,
  modifierTexts,
  skillTag,
  tagStructLiteral,
  weaponClassName,
} from './battle';
import {
  ATTRIBUTE_HEADER,
  CHARACTER_HEADER,
  EFFECT_HEADER,
  GAMEPLAY_TAGS_HEADER,
  SKILL_HEADER,
  WEAPON_HEADER,
  buildBattleRows,
} from './battle-export';
import { validateBattle } from './battle-validate';
import type { GasEffect, GasModifier, GasPair, Project } from './types';

function modifier(over: Partial<GasModifier> = {}): GasModifier {
  // 属性那一格存的是属性表的 uid：a1 = 生命值
  return { uid: 'm1', duration: '基础', attributeUid: 'a1', operator: '-', value: 'Damage', ...over };
}

function pair(key: string, value: string): GasPair {
  return { uid: `p-${key}`, key, value };
}

function effect(over: Partial<GasEffect> = {}): GasEffect {
  return {
    uid: 'e1',
    name: '中毒',
    note: '每 1s 扣血',
    className: 'BP_GameEffect_Base',
    duration: '10',
    period: '1',
    periodImmediate: false,
    reduceStacks: '1',
    maxStacks: '5',
    refreshDuration: true,
    refreshPeriod: false,
    modifiers: [modifier()],
    tagNote: '中毒效果',
    ...over,
  };
}

/** 一份把七张表都填了一点儿的项目数据 */
function makeProject(): Project {
  const battle = createEmptyBattle();
  battle.attributes = [
    { uid: 'a1', name: '生命值', note: '血量', tagNote: '血量标签' },
    { uid: 'a2', name: '移动速度', note: '', tagNote: '' },
  ];
  battle.events = [{ uid: 'v1', name: '受击', note: '', tagNote: '' }];
  battle.effects = [effect()];
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
      // 引用的是那一行的 uid：s1 = 回血、v1 = 受击
      lockSkillUids: ['s1'],
      listenEventUids: ['v1'],
      parameters: [pair('Speed', '10'), pair('Attack', '20')],
      tagNote: '加速技能',
    },
  ];
  battle.characters = [
    {
      uid: 'c1',
      id: 'CHA_测试主角',
      name: '测试主角',
      // 属性列表的 key 是属性 uid：a2 = 移动速度、a1 = 生命值
      attributes: [pair('a2', '5'), pair('a1', '100')],
      skillUids: ['s1', 's2'],
      weaponBindings: [],
      weapons: [],
    },
  ];
  battle.weapons = [
    {
      uid: 'w1',
      id: 'WEA_测试-手枪',
      name: '测试-手枪',
      description: '测试用直线远程武器',
      nameEn: '',
      nameJa: '',
      descriptionEn: '',
      descriptionJa: '',
      magazine: '10',
      attackSpeed: '1',
      energyCost: '5',
      attackModeUids: [],
      slotUids: [],
    },
  ];

  return {
    version: 1,
    playPositions: [],
    expressions: [],
    name: '战斗测试',
    characters: [],
    items: [],
    quests: [],
    images: [],
    imageCategories: [],
    soundCategories: [],
    sounds: [],
    commands: [],
    chapters: [],
    variables: [],
    uiTexts: [],
    battle,
    specialCommandClassPrefix: '',
    exportSettings: [],
  };
}

describe('战斗模块的 Tag 合成', () => {
  it('各表前缀对上样例里的 Tag', () => {
    expect(attributeTag('生命值')).toBe('GAS.属性.生命值');
    expect(effectTag('中毒')).toBe('GAS.效果.中毒');
    expect(skillTag('测试手枪-攻击')).toBe('GAS.技能.测试手枪-攻击');
    expect(eventTag('受击')).toBe('GAS.事件.受击');
  });

  it('名字空着时不给半截 Tag', () => {
    expect(attributeTag('   ')).toBe('');
    expect(skillTag('')).toBe('');
    expect(tagStructLiteral('')).toBe('');
  });

  it('属性 / 事件标签写成结构体字面量', () => {
    expect(tagStructLiteral('GAS.属性.生命值')).toBe('(TagName="GAS.属性.生命值")');
  });

  it('修改器文本是「持续类型#属性名 运算符 值」，没填完的不合成', () => {
    const nameOf = (): string => '生命值';
    expect(modifierText(modifier(), '生命值')).toBe('基础#生命值-Damage');
    expect(modifierText(modifier({ duration: '固定', attributeUid: 'a2', operator: '+', value: '40' }), '移动速度')).toBe(
      '固定#移动速度+40',
    );
    // 属性名查不出来（悬空引用）时不合成，免得导出半截字符串
    expect(modifierText(modifier({ value: '' }), '生命值')).toBe('');
    expect(modifierTexts([modifier(), modifier({ uid: 'm2', value: '' })], nameOf)).toEqual([
      '基础#生命值-Damage',
    ]);
  });

  it('类名补成 Unreal 的全路径', () => {
    expect(classPath("/Script/Engine.BlueprintGeneratedClass'/Game/GC/BSGA/", 'BP_GA_Heal')).toBe(
      "/Script/Engine.BlueprintGeneratedClass'/Game/GC/BSGA/BP_GA_Heal.BP_GA_Heal_C'",
    );
    expect(classPath('前缀/', '  ')).toBe('');
  });

  it('键值对写成 (("K","V")) 的形式', () => {
    expect(formatPairLiteral([pair('Speed', '10'), pair('Attack', '20')])).toBe(
      '(("Speed","10"),("Attack","20"))',
    );
    expect(formatPairLiteral([])).toBe('');
  });

  it('收集 GameplayTags：按 属性 / 效果 / 技能 / 事件 分组，名字空的跳过', () => {
    const project = makeProject();
    project.battle.skills.push({
      uid: 's3',
      name: '',
      className: '',
      lockSkillUids: [],
      listenEventUids: [],
      parameters: [],
      tagNote: '',
    });

    const entries = collectGameplayTags(project.battle);

    expect(entries.map((entry) => [entry.group, entry.tag])).toEqual([
      ['属性', 'GAS.属性.生命值'],
      ['属性', 'GAS.属性.移动速度'],
      ['效果', 'GAS.效果.中毒'],
      ['技能', 'GAS.技能.回血'],
      ['技能', 'GAS.技能.加速'],
      ['事件', 'GAS.事件.受击'],
    ]);
    expect(entries[0].tagNote).toBe('血量标签');
    expect(entries[2].uid).toBe('e1');
  });
});

describe('战斗模块的导出', () => {
  const rows = buildBattleRows(makeProject());

  it('GameplayTags 表：第一列与 Tag 列都是合成后的 Tag，第三列是备注', () => {
    expect(rows.gameplayTags[0]).toEqual([...GAMEPLAY_TAGS_HEADER]);
    expect(rows.gameplayTags[1]).toEqual(['GAS.属性.生命值', 'GAS.属性.生命值', '血量标签']);
    expect(rows.gameplayTags).toHaveLength(7); // 表头 + 6 条
  });

  it('属性表只有 行名 / 属性名 / 属性标签 三列', () => {
    expect(rows.attributes[0]).toEqual([...ATTRIBUTE_HEADER]);
    expect(rows.attributes[1]).toEqual(['GAS.属性.生命值', '生命值', '(TagName="GAS.属性.生命值")']);
    for (const row of rows.attributes) expect(row).toHaveLength(3);
  });

  it('效果表去掉输入列与 Tag / DevComment，布尔写成 True / False', () => {
    expect(rows.effects[0]).toEqual([...EFFECT_HEADER]);
    expect(rows.effects[0]).not.toContain('修改器列表（换行分割）');
    expect(rows.effects[0]).not.toContain('DevComment');
    // 类名是策划填的输入列，只导出补全后的 GE类
    expect(rows.effects[0]).not.toContain('类名');
    expect(rows.effects[0]).toContain('GE类');
    expect(rows.effects[1]).toEqual([
      'GAS.效果.中毒',
      '中毒',
      '每 1s 扣血',
      '10',
      '1',
      'False',
      '1',
      '5',
      'True',
      'False',
      '("基础#生命值-Damage")',
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/GE/BSGE/BP_GameEffect_Base.BP_GameEffect_Base_C'",
    ]);
  });

  it('技能表：多选与参数赋值写成数组字面量，GA类 由类名补全', () => {
    expect(rows.skills[0]).toEqual([...SKILL_HEADER]);
    expect(rows.skills[0]).not.toContain('类名');
    expect(rows.skills[0]).toContain('GA类');
    expect(rows.skills[2]).toEqual([
      'GAS.技能.加速',
      '加速',
      '("GAS.技能.回血")',
      '("GAS.事件.受击")',
      '(("Speed","10"),("Attack","20"))',
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/GA/BSGA/BP_GA_IncreaseSpeed.BP_GA_IncreaseSpeed_C'",
    ]);
    // 空列表写空单元格，不是 ()
    expect(rows.skills[1][2]).toBe('');
  });

  it('角色表：行名是角色 ID，属性 key 换成属性 Tag', () => {
    expect(rows.characters[0]).toEqual([...CHARACTER_HEADER]);
    expect(rows.characters[1]).toEqual([
      'CHA_测试主角',
      '测试主角',
      '(("GAS.属性.移动速度","5"),("GAS.属性.生命值","100"))',
      '("GAS.技能.回血","GAS.技能.加速")',
      // 还没带武器时「武器」与「武器绑定关系」两列都留空
      '',
      '',
    ]);
  });

  it('角色表的「武器」列与「武器绑定关系」列：武器按下标、绑定关系写 分组|插槽|下标|攻击模式', () => {
    const project = makeProject();
    const battle = project.battle;
    battle.weaponGroups = [
      { uid: 'wg1', name: '火力', exportName: 'TXT_WeaponTeam_火力', nameEn: '', nameJa: '' },
      { uid: 'wg2', name: '光束', exportName: 'TXT_WeaponTeam_光束', nameEn: '', nameJa: '' },
    ];
    battle.slots = [
      { uid: 'sl1', name: '右手', exportName: 'TXT_WeaponTeamSlot_右手', nameEn: '', nameJa: '' },
      { uid: 'sl2', name: '后背', exportName: 'TXT_WeaponTeamSlot_后背', nameEn: '', nameJa: '' },
    ];
    battle.attackModes = [
      { uid: 'am1', name: '手动攻击', exportName: 'TXT_AttackMode_手动攻击', nameEn: '', nameJa: '' },
      { uid: 'am2', name: '自动攻击', exportName: 'TXT_AttackMode_自动攻击', nameEn: '', nameJa: '' },
    ];
    // 武器列：三条，第二条没选武器（不占下标、也不出现在导出的武器列里）
    battle.characters[0].weapons = [
      { uid: 'cw1', weaponUid: 'w1' },
      { uid: 'cw2', weaponUid: '' },
      { uid: 'cw3', weaponUid: 'w1' },
    ];
    // 绑定关系：火力下右手装第 1 条、后背装第 2 条；光束下右手装第 2 条
    battle.characters[0].weaponBindings = [
      {
        uid: 'gb1',
        groupUid: 'wg1',
        mounts: [
          { slotUid: 'sl1', weaponEntryUid: 'cw1', attackModeUid: 'am1' },
          { slotUid: 'sl2', weaponEntryUid: 'cw3', attackModeUid: 'am2' },
        ],
      },
      {
        uid: 'gb2',
        groupUid: 'wg2',
        mounts: [{ slotUid: 'sl1', weaponEntryUid: 'cw3', attackModeUid: 'am2' }],
      },
    ];

    const row = buildBattleRows(project).characters[1];
    // 武器列：允许重复，按顺序每个武器一个 ID
    expect(row[4]).toBe('("WEA_测试-手枪","WEA_测试-手枪")');
    // 绑定关系列：分组|插槽|武器下标|攻击模式，下标从 1 开始
    expect(row[5]).toBe(
      '("TXT_WeaponTeam_火力|TXT_WeaponTeamSlot_右手|1|TXT_AttackMode_手动攻击","TXT_WeaponTeam_火力|TXT_WeaponTeamSlot_后背|2|TXT_AttackMode_自动攻击","TXT_WeaponTeam_光束|TXT_WeaponTeamSlot_右手|2|TXT_AttackMode_自动攻击")',
    );
  });

  it('武器表：行名是武器 ID，武器名 / 描述导出文本 key，末尾带武器图标与武器类', () => {
    expect(rows.weapons[0]).toEqual([...WEAPON_HEADER]);
    expect(rows.weapons[1]).toEqual([
      'WEA_测试-手枪',
      // 武器名 / 描述导出的是本地化 key
      'TXT_WeaponName_WEA_测试-手枪',
      'TXT_WeaponInfo_WEA_测试-手枪',
      '10',
      '1',
      '5',
      // 没勾攻击模式 / 插槽时两列留空
      '',
      '',
      // 武器图标按武器 ID 现算：PIC_<武器ID>
      'PIC_WEA_测试-手枪',
      // 武器类 = 前缀 + BP_Weapon_<武器ID去WEA_>
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/Weapon/WeaponActors/BP_Weapon_测试-手枪.BP_Weapon_测试-手枪_C'",
    ]);
  });

  it('武器类名按武器 ID 推：WEA_ 换成 BP_Weapon_；前缀改了就跟着变', () => {
    expect(weaponClassName('WEA_Test_Sniper')).toBe('BP_Weapon_Test_Sniper');
    expect(weaponClassName('WEA_')).toBe('');
    expect(weaponClassName('')).toBe('');

    const project = makeProject();
    project.battle.weaponClassPrefix = "/Game/BP/Weapon/";
    expect(buildBattleRows(project).weapons[1][9]).toBe(
      "/Game/BP/Weapon/BP_Weapon_测试-手枪.BP_Weapon_测试-手枪_C'",
    );
  });

  it('前缀为空时武器类这一列写 None（和样例一致）', () => {
    const project = makeProject();
    project.battle.weaponClassPrefix = '';
    expect(buildBattleRows(project).weapons[1][9]).toBe('None');
  });

  it('支持攻击模式列表写成 (A,B,C)、支持插槽列表写成 ("a","b")，都用导出名称', () => {
    const project = makeProject();
    project.battle.attackModes = [
      { uid: 'am1', name: '手动攻击', exportName: 'TXT_AttackMode_手动攻击', nameEn: '', nameJa: '' },
      { uid: 'am2', name: '自动攻击', exportName: 'TXT_AttackMode_自动攻击', nameEn: '', nameJa: '' },
      { uid: 'am3', name: '点防御', exportName: 'TXT_AttackMode_点防御', nameEn: '', nameJa: '' },
    ];
    project.battle.slots = [
      { uid: 'sl1', name: '槽一', exportName: '111', nameEn: '', nameJa: '' },
      { uid: 'sl2', name: '槽二', exportName: '222', nameEn: '', nameJa: '' },
    ];
    project.battle.weapons[0].attackModeUids = ['am1', 'am2', 'am3'];
    project.battle.weapons[0].slotUids = ['sl1', 'sl2'];

    const row = buildBattleRows(project).weapons[1];
    expect(row[6]).toBe('(TXT_AttackMode_手动攻击,TXT_AttackMode_自动攻击,TXT_AttackMode_点防御)');
    expect(row[7]).toBe('("111","222")');
  });

  it('导出名称为空的那一条不写进去', () => {
    const project = makeProject();
    project.battle.attackModes = [
      { uid: 'am1', name: '手动攻击', exportName: '  ', nameEn: '', nameJa: '' },
      { uid: 'am2', name: '自动攻击', exportName: 'TXT_AttackMode_自动攻击', nameEn: '', nameJa: '' },
    ];
    project.battle.weapons[0].attackModeUids = ['am1', 'am2'];

    expect(buildBattleRows(project).weapons[1][6]).toBe('(TXT_AttackMode_自动攻击)');
  });

  it('名字空着的行不进表', () => {
    const project = makeProject();
    project.battle.attributes.push({ uid: 'a3', name: '  ', note: '', tagNote: '' });
    expect(buildBattleRows(project).attributes).toHaveLength(3); // 表头 + 2 条
  });
});

describe('战斗模块的校验', () => {
  it('干净的数据没有问题', () => {
    const report = validateBattle(makeProject());
    expect(report.issues).toEqual([]);
  });

  it('重名会报错，只报一条并带上子页面与行 uid', () => {
    const project = makeProject();
    project.battle.attributes.push({ uid: 'a9', name: '生命值', note: '', tagNote: '' });

    const report = validateBattle(project);

    expect(report.errors).toBe(1);
    expect(report.issues[0].code).toBe('battle-duplicate-name');
    expect(report.issues[0].battlePage).toBe('attributes');
    expect(report.issues[0].battleUid).toBe('a1');
    expect(report.issues[0].message).toContain('2 条');
  });

  it('修改器引用不存在的属性、值没填，各报一条', () => {
    const project = makeProject();
    project.battle.effects[0].modifiers = [
      modifier({ uid: 'm1', attributeUid: '不存在的属性' }),
      modifier({ uid: 'm2', value: '' }),
    ];

    const report = validateBattle(project);

    expect(report.issues.map((item) => item.code)).toEqual([
      'battle-unknown-attribute',
      'battle-empty-modifier',
    ]);
    expect(report.issues[0].where).toBe('效果');
  });

  it('技能锁定的 GA 被删掉之后会报悬空引用', () => {
    const project = makeProject();
    project.battle.skills[1].lockSkillUids = ['已经删掉的技能'];

    const report = validateBattle(project);

    expect(report.issues.map((item) => item.code)).toEqual(['battle-dangling-ref']);
    expect(report.issues[0].message).toContain('已经删掉的技能');
  });

  it('引用行被删掉之后（uid 悬空）也说得出是哪一栏坏了', () => {
    const project = makeProject();
    project.battle.characters[0].skillUids = ['8f3c1b2a-1234-4def-9abc-0123456789ab'];

    const report = validateBattle(project);

    expect(report.issues.map((item) => item.code)).toEqual(['battle-dangling-ref']);
    // uid 读不出是哪一条，就不把乱码摆出来
    expect(report.issues[0].message).not.toContain('8f3c1b2a');
    expect(report.issues[0].message).toContain('技能列表');
  });

  it('角色属性列表里同一属性写两次会报错', () => {
    const project = makeProject();
    project.battle.characters[0].attributes = [pair('生命值', '1'), pair('生命值', '2')];

    const report = validateBattle(project);

    expect(report.issues.map((item) => item.code)).toEqual(['battle-duplicate-pair']);
  });

  it('角色 / 武器 ID 重复、数值列不是数字都会报出来', () => {
    const project = makeProject();
    project.battle.weapons.push({ ...project.battle.weapons[0], uid: 'w2' });
    project.battle.weapons[0].magazine = '十发';

    const report = validateBattle(project);

    expect(report.issues.map((item) => item.code).sort()).toEqual([
      'battle-duplicate-id',
      'battle-not-number',
    ]);
    expect(report.issues.find((item) => item.code === 'battle-not-number')?.battlePage).toBe('weapons');
  });
});
