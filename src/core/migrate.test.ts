import { describe, expect, it } from 'vitest';

import { normalizeProject } from './migrate';
import type { Group, Project } from './types';

/** 老结构的一行：指令挂在行上（commands 数组），类型里还有「其他」 */
function legacyLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'l1',
    readableId: 'Dia_ch01_001-1',
    kind: '对话',
    characterId: 'CHA_伊芙',
    displayName: '伊芙',
    text: { zh: '第一句', en: 'one', ja: '' },
    autoAdvance: false,
    commands: [],
    optionIds: [],
    ...over,
  };
}

/** 老结构的选项 */
function legacyOption(uid: string, readableId: string, over: Record<string, unknown> = {}) {
  return {
    uid,
    readableId,
    text: { zh: `选项${uid}`, en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
    results: [],
    ...over,
  };
}

function legacyProject(
  lines: Record<string, unknown>[],
  options: Record<string, unknown>[] = [],
) {
  return {
    version: 1,
    name: '老项目',
    characters: [{ uid: 'ch1', id: 'CHA_伊芙', name: '伊芙' }],
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
        groups: [{ uid: 'g1', id: '001', title: '开场', lines, options }],
      },
    ],
  };
}

const groupOf = (project: Project): Group => project.chapters[0].groups[0];

describe('老结构自动迁移', () => {
  it('行上的指令拆成它前面的「指令」行，选项拆成它后面的「选项」行', () => {
    const result = normalizeProject(
      legacyProject([
        legacyLine({ commands: ['剧情.特殊# SP_1'] }),
        legacyLine({
          uid: 'l2',
          readableId: 'Dia_ch01_001-2',
          text: { zh: '第二句', en: '', ja: '' },
          autoAdvance: true,
          optionIds: ['o-a', 'o-b'],
        }),
      ]),
    );
    expect(result).not.toBeNull();
    const group = groupOf(result!.project);

    expect(group.lines.map((line) => line.kind)).toEqual(['指令', '对话', '对话', '选项']);
    expect(group.lines[0].command).toBe('剧情|特殊|参数1:SP_1');
    expect(group.lines[1].uid).toBe('l1');
    expect(group.lines[1].text.zh).toBe('第一句');
    expect(group.lines[2].uid).toBe('l2');
    expect(group.lines[2].autoAdvance).toBe(true);
    expect(group.lines[3].optionIds).toEqual(['o-a', 'o-b']);

    // 内容一个字都没改；角色那一格从角色 ID 换成了角色表的 uid
    expect(group.lines[1].characterUid).toBe('ch1');
    expect(group.lines[1].text.en).toBe('one');
  });

  it('迁移后段内 ID 连续重排，选项跟着所属行编号，并给出对照表', () => {
    const options = [legacyOption('o-a', 'Dia_ch01_001-2A'), legacyOption('o-b', 'Dia_ch01_001-2B')];
    const result = normalizeProject(
      legacyProject(
        [
          legacyLine({ commands: ['剧情.特殊# SP_1'] }),
          legacyLine({ uid: 'l2', readableId: 'Dia_ch01_001-2', optionIds: ['o-a', 'o-b'] }),
        ],
        options,
      ),
    );
    const group = groupOf(result!.project);

    expect(group.lines.map((line) => line.readableId)).toEqual([
      'Dia_ch01_001-1',
      'Dia_ch01_001-2',
      'Dia_ch01_001-3',
      'Dia_ch01_001-4',
    ]);
    expect(group.options.map((option) => option.readableId)).toEqual([
      'Dia_ch01_001-4A',
      'Dia_ch01_001-4B',
    ]);
    expect(result!.changes).toHaveLength(4);
    expect(result!.changes).toContainEqual({
      uid: 'o-a',
      oldId: 'Dia_ch01_001-2A',
      newId: 'Dia_ch01_001-4A',
    });
  });

  it('「其他」行有文本就留成「对话」行，只有指令时不再单独占一行', () => {
    const result = normalizeProject(
      legacyProject([
        legacyLine({
          uid: 'a1',
          kind: '其他',
          characterId: '',
          displayName: 'HUD',
          text: { zh: '认知能力鉴定——失败', en: '', ja: '' },
          commands: ['剧情.特殊# SP_2'],
        }),
        legacyLine({
          uid: 'a2',
          kind: '其他',
          characterId: '',
          displayName: '',
          text: { zh: '', en: '', ja: '' },
          commands: ['剧情.特殊# SP_3'],
        }),
      ]),
    );
    const group = groupOf(result!.project);

    // 有文本的：一条指令 + 一行保留文本的对话
    expect(group.lines.map((line) => line.kind)).toEqual(['指令', '对话', '指令']);
    expect(group.lines[1].uid).toBe('a1');
    // 老结构里的显示名「HUD」被收进角色表的别名里（那一行没选角色，所以原样留着）
    expect(group.lines[1].displayAliasUid).toBe('HUD');
    expect(group.lines[1].text.zh).toBe('认知能力鉴定——失败');
    // 没文本的：只剩指令
    expect(group.lines[2].command).toBe('剧情|特殊|参数1:SP_3');
  });

  it('对话行的显示名收进角色表的别名：同名只建一个，译文跟着搬', () => {
    const result = normalizeProject({
      version: 1,
      name: '老项目',
      characters: [{ uid: 'ch1', id: 'CHA_旁白', name: '旁白' }],
      items: [],
      quests: [],
      images: [],
      sounds: [],
      commands: [],
      variables: [],
      uiTexts: [],
      // 老版本把译名单独存在这里，迁移时要搬到别名上
      nameTexts: [{ uid: 'l1', en: 'HUD', ja: 'HUD' }],
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
              options: [],
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '对话',
                  characterId: 'CHA_旁白',
                  displayName: 'HUD',
                  text: { zh: '第一句' },
                },
                {
                  uid: 'l2',
                  readableId: 'Dia_ch01_001-2',
                  kind: '对话',
                  characterId: 'CHA_旁白',
                  displayName: 'HUD',
                  text: { zh: '第二句' },
                },
                {
                  uid: 'l3',
                  readableId: 'Dia_ch01_001-3',
                  kind: '对话',
                  characterId: 'CHA_旁白',
                  displayName: '旁白',
                  text: { zh: '第三句' },
                },
                {
                  uid: 'l4',
                  readableId: 'Dia_ch01_001-4',
                  kind: '对话',
                  characterId: '',
                  displayName: '没角色的名字',
                  text: { zh: '第四句' },
                },
              ],
            },
          ],
        },
      ],
    });

    const project = result!.project;
    const character = project.characters[0];
    // 两行都写 HUD：只建一个别名，译文从老表搬过来
    expect(character.aliases).toHaveLength(1);
    expect(character.aliases[0].text).toBe('HUD');
    expect(character.aliases[0].en).toBe('HUD');

    const lines = project.chapters[0].groups[0].lines;
    expect(lines[0].displayAliasUid).toBe(character.aliases[0].uid);
    expect(lines[1].displayAliasUid).toBe(character.aliases[0].uid);
    // 与默认名称相同 → 回到「（默认名称）」
    expect(lines[2].displayAliasUid).toBe('');
    // 没选角色，收不进去：原样留着，交给校验条提醒
    expect(lines[3].displayAliasUid).toBe('没角色的名字');

    // 再读一遍不变
    const twice = normalizeProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(JSON.stringify(twice!.project)).toBe(JSON.stringify(project));
  });

  it('已经是新结构的数据原样保留，不产生对照表', () => {    const result = normalizeProject({
      version: 1,
      name: '新项目',
      items: [],
      quests: [],
      images: [],
      sounds: [],
      commands: [],
      variables: [],
      characters: [],
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
              options: [],
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '指令',
                  command: '剧情.特殊# SP_1',
                  note: '这句要等 BGM 淡出',
                  characterId: '',
                  displayAliasUid: '',
                  text: { zh: '', en: '', ja: '' },
                  autoAdvance: false,
                  optionIds: [],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result!.changes).toEqual([]);
    const line = groupOf(result!.project).lines[0];
    expect(line.kind).toBe('指令');
    expect(line.command).toBe('剧情|特殊|参数1:SP_1');
    expect(line.note).toBe('这句要等 BGM 淡出');
    expect(line.readableId).toBe('Dia_ch01_001-1');
    // 老项目里没有 jumpGroupUid：要当成普通指令行，别被认成「跳转到段落」行
    expect(line.jumpGroupUid).toBeNull();
    // 老项目里也没有 specialContent：别被认成「特殊演出效果」行
    expect(line.specialContent).toBeNull();
    // 可用条件同样要补成空表，不然导出时读到 undefined 会炸
    expect(line.jumpConditions).toEqual([]);
  });

  it('「跳转到段落」行的段落引用与可用条件都读得回来', () => {
    const result = normalizeProject({
      version: 1,
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
              options: [],
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '指令',
                  command: '',
                  jumpGroupUid: 'g2',
                  jumpConditions: ['背包||物品:Item_Coin;运算符:>=;数量:10'],
                  characterId: '',
                  displayAliasUid: '',
                  text: { zh: '', en: '', ja: '' },
                  autoAdvance: false,
                  optionIds: [],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(groupOf(result!.project).lines[0].jumpGroupUid).toBe('g2');
    expect(groupOf(result!.project).lines[0].jumpConditions).toEqual(['背包||物品:Item_Coin;运算符:>=;数量:10']);
  });

  it('「特殊演出效果」行的指令与指令内容都读得回来', () => {
    const result = normalizeProject({
      version: 1,
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
              options: [],
              lines: [
                {
                  uid: 'l1',
                  readableId: 'Dia_ch01_001-1',
                  kind: '指令',
                  command: '特殊# SP_CameraShake',
                  specialContent: '屏幕震一下',
                  characterId: '',
                  displayAliasUid: '',
                  text: { zh: '', en: '', ja: '' },
                  autoAdvance: false,
                  optionIds: [],
                },
              ],
            },
          ],
        },
      ],
    });

    const line = groupOf(result!.project).lines[0];
    expect(line.command).toBe('特殊||特殊指令:SP_CameraShake');
    expect(line.specialContent).toBe('屏幕震一下');
  });

  it('缺字段的老数据能补齐，不抛错', () => {
    const result = normalizeProject({
      version: 1,
      name: '半截项目',
      chapters: [{ uid: 'c1', id: 'ch01', title: '序章', groups: [{ uid: 'g1', id: '001' }] }],
    });

    expect(result).not.toBeNull();
    expect(result!.project.characters).toEqual([]);
    expect(result!.project.commands).toEqual([]);
    expect(groupOf(result!.project).lines).toEqual([]);
    expect(groupOf(result!.project).options).toEqual([]);
  });

  it('不是 StoryMaker 项目的 JSON 返回 null', () => {
    expect(normalizeProject(null)).toBeNull();
    expect(normalizeProject('一段文本')).toBeNull();
    expect(normalizeProject({ version: 2, chapters: [] })).toBeNull();
    expect(normalizeProject({ version: 1 })).toBeNull();
  });

  it('没有 UI 本地化的老项目补一张空表', () => {
    const result = normalizeProject({
      version: 1,
      name: '老项目',
      chapters: [{ uid: 'c1', id: 'ch01', title: '序章', groups: [] }],
    });

    expect(result!.project.uiTexts).toEqual([]);
  });

  it('UI 本地化的行逐行收窄：缺字段补齐，非对象直接丢掉', () => {
    const result = normalizeProject({
      version: 1,
      name: '手改过的项目',
      chapters: [],
      uiTexts: [
        { uid: 'ui-1', key: 'TXT_Widget_设置', text: { zh: '设置', en: 'Setting' } },
        { key: 'TXT_Widget_返回' },
        '这不是一行',
        null,
      ],
    });

    expect(result!.project.uiTexts).toEqual([
      { uid: 'ui-1', key: 'TXT_Widget_设置', text: { zh: '设置', en: 'Setting', ja: '' } },
      { uid: expect.any(String), key: 'TXT_Widget_返回', text: { zh: '', en: '', ja: '' } },
    ]);
  });
});

describe('指令字典与指令文本迁移', () => {
  /** 老格式的字典：同一个「剧情.演出」下四条动作各占一行 */
  function oldDef(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      uid: 'old-def',
      category: '指令',
      head: '剧情.演出',
      branch: '设置表情',
      target: 'character',
      attribute: '表情',
      operator: '=',
      value: 'expression',
      fixedValues: [],
      note: '表情清单在角色表里配置',
      ...over,
    };
  }

  it('老默认字典按「主指令 + 分支」合并成新条目', () => {
    const result = normalizeProject({
      ...legacyProject([legacyLine()]),
      commands: [
        oldDef({ uid: 'd1', branch: '立绘进入', attribute: '进入', value: 'fixed', fixedValues: ['1'] }),
        oldDef({ uid: 'd2', branch: '立绘退出', attribute: '退出', value: 'fixed', fixedValues: ['1'] }),
        oldDef({ uid: 'd3' }),
        oldDef({ uid: 'd4', branch: '设置动作', attribute: '动作', value: 'action' }),
      ],
    });

    const defs = result!.project.commands;
    expect(defs).toHaveLength(1);
    expect(defs[0].head).toBe('剧情');
    expect(defs[0].branch).toBe('演出');
    // 四个动作都变成参数，角色仍然是必填
    expect(defs[0].params.map((param) => param.name)).toEqual([
      '角色',
      '立绘位移',
      '表情',
      '动作',
    ]);
    expect(defs[0].params[0].required).toBe(true);
    expect(defs[0].params[1].options).toEqual(['进入', '退出']);
  });

  it('老指令文本按确认过的写法改写成 E2', () => {
    const result = normalizeProject({
      ...legacyProject([
        { uid: 'l1', readableId: 'Dia_ch01_001-1', kind: '指令', command: '剧情.演出# CHA_伊芙.进入=0' },
        { uid: 'l2', readableId: 'Dia_ch01_001-2', kind: '指令', command: '剧情.演出# CHA_伊芙.表情=悲伤' },
        { uid: 'l3', readableId: 'Dia_ch01_001-3', kind: '指令', command: '背包# Item_Coin+100' },
        { uid: 'l4', readableId: 'Dia_ch01_001-4', kind: '指令', command: '剧情.图片# 移除' },
        { uid: 'l5', readableId: 'Dia_ch01_001-5', kind: '指令', command: '特殊# SP_001' },
        { uid: 'l6', readableId: 'Dia_ch01_001-6', kind: '指令', command: '地图.时间# +1' },
      ]),
      commands: [
        oldDef({ uid: 'd1', branch: '立绘进入', attribute: '进入', value: 'fixed', fixedValues: ['1'] }),
        oldDef({ uid: 'd2' }),
        oldDef({ uid: 'd3', head: '背包', branch: '', target: 'item', attribute: '', operator: '+', value: 'number' }),
        oldDef({ uid: 'd4', head: '剧情.图片', branch: '', target: 'image', attribute: '', operator: '', value: 'none' }),
        oldDef({ uid: 'd5', head: '剧情.图片', branch: '移除图片', target: 'manual', attribute: '', operator: '', value: 'none' }),
        oldDef({ uid: 'd6', head: '特殊', branch: '', target: 'manual', attribute: '', operator: '', value: 'none' }),
        oldDef({ uid: 'd7', head: '地图.时间', branch: '', target: 'manual', attribute: '', operator: '+', value: 'number' }),
      ],
    });

    const commands = groupOf(result!.project).lines.map((line) => line.command);
    expect(commands).toEqual([
      '剧情|演出|角色:ch1;立绘位移:进入',
      '剧情|演出|角色:ch1;表情:悲伤',
      '背包||物品:Item_Coin;运算符:+;数量:100',
      '剧情|图片|',
      '特殊||特殊指令:SP_001',
      '地图|时间|运算符:+;小时:1',
    ]);
  });

  it('字典里没有的老指令自动建一条，参数原样兜住', () => {
    const result = normalizeProject({
      ...legacyProject([
        { uid: 'l1', readableId: 'Dia_ch01_001-1', kind: '指令', command: '剧情.拍摄# CAM_1' },
      ]),
    });

    const def = result!.project.commands.find((item) => item.head === '剧情' && item.branch === '拍摄');
    expect(def?.params.map((param) => param.name)).toEqual(['参数1']);
    expect(groupOf(result!.project).lines[0].command).toBe('剧情|拍摄|参数1:CAM_1');
  });

  it('已经是新格式的文本原样保留', () => {
    const result = normalizeProject(
      legacyProject([
        { uid: 'l1', readableId: 'Dia_ch01_001-1', kind: '指令', command: '特殊||特殊指令:SP_1' },
      ]),
    );
    expect(groupOf(result!.project).lines[0].command).toBe('特殊||特殊指令:SP_1');
  });
});

describe('选项结果搬成新段落', () => {
  it('每个带结果的选项建一个段落：指令行 + 跳回原目标，选项改跳过去', () => {
    const result = normalizeProject({
      ...legacyProject(
        [
          { uid: 'u1', readableId: 'Dia_ch01_001-1', kind: '选项', optionIds: ['o1'] },
          { uid: 'u2', readableId: 'Dia_ch01_001-2', kind: '对话', text: { zh: '下一句' } },
        ],
        [
          legacyOption('o1', 'Dia_ch01_001-1A', {
            nextId: 'u2',
            results: ['特殊||特殊指令:SP_1', '背包||物品:Item_Coin;运算符:+;数量:1'],
          }),
        ],
      ),
    });

    const chapter = result!.project.chapters[0];
    expect(chapter.groups).toHaveLength(2);
    const created = chapter.groups[1];
    expect(created.id).toBe('002');
    expect(created.title).toBe('（选项结果）');
    expect(created.lines.map((line) => line.command)).toEqual([
      '特殊||特殊指令:SP_1',
      '背包||物品:Item_Coin;运算符:+;数量:1',
      '',
    ]);
    // 末尾那条是「跳转到段落」，指回原来的跳转目标所在的段落
    const jump = created.lines[2];
    expect(jump.kind).toBe('指令');
    expect(jump.jumpGroupUid).toBe('g1');
    // 选项改成跳到新段落的第一句
    const option = chapter.groups[0].options[0];
    expect(option.nextId).toMatch(/^@first:/);
    expect('results' in option).toBe(false);
  });

  it('原来就没有跳转目标的选项：段落里只有指令，末尾不补跳转', () => {
    const result = normalizeProject(
      legacyProject(
        [{ uid: 'u1', readableId: 'Dia_ch01_001-1', kind: '选项', optionIds: ['o1'] }],
        [legacyOption('o1', 'Dia_ch01_001-1A', { results: ['特殊||特殊指令:SP_1'] })],
      ),
    );

    const created = result!.project.chapters[0].groups[1];
    expect(created.lines).toHaveLength(1);
    expect(result!.project.chapters[0].groups[0].options[0].nextId).toMatch(/^@first:/);
  });
});
