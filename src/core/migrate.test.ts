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
    expect(group.lines[0].command).toBe('剧情.特殊# SP_1');
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
    expect(group.lines[1].displayName).toBe('HUD');
    expect(group.lines[1].text.zh).toBe('认知能力鉴定——失败');
    // 没文本的：只剩指令
    expect(group.lines[2].command).toBe('剧情.特殊# SP_3');
  });

  it('已经是新结构的数据原样保留，不产生对照表', () => {
    const result = normalizeProject({
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
                  displayName: '',
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
    expect(line.command).toBe('剧情.特殊# SP_1');
    expect(line.note).toBe('这句要等 BGM 淡出');
    expect(line.readableId).toBe('Dia_ch01_001-1');
    // 老项目里没有 jumpGroupUid：要当成普通指令行，别被认成「跳转到段落」行
    expect(line.jumpGroupUid).toBeNull();
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
                  jumpConditions: ['背包#Item_Coin>=10'],
                  characterId: '',
                  displayName: '',
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
    expect(groupOf(result!.project).lines[0].jumpConditions).toEqual(['背包#Item_Coin>=10']);
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
