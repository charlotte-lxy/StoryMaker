import { describe, expect, it } from 'vitest';

import { validateLocalization, validateProject } from './validate';
import type { Group, Line, Project, StoryOption } from './types';

function makeLine(uid: string, readableId: string, over: Partial<Line> = {}): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterId: 'CHA_伊芙',
    displayName: '伊芙',
    text: { zh: '台词', en: '', ja: '' },
    autoAdvance: false,
    command: '',
    optionIds: [],
    note: '',
    ...over,
  };
}

function makeOption(uid: string, readableId: string, over: Partial<StoryOption> = {}): StoryOption {
  return {
    uid,
    readableId,
    text: { zh: '选项', en: '', ja: '' },
    nextId: '',
    appearConditions: [],
    enableConditions: [],
    results: [],
    ...over,
  };
}

function makeProject(group: Partial<Group>): Project {
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
    chapters: [
      {
        uid: 'c1',
        id: 'ch01',
        title: '序章',
        groups: [{ uid: 'g1', id: '001', title: '开场', note: '', lines: [], options: [], ...group }],
      },
    ],
  };
}

it('干净的工程没有告警', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1'), makeLine('u2', 'Dia_ch01_001-2')],
  });
  expect(validateProject(project)).toMatchObject({ errors: 0, warnings: 0, issues: [] });
});

it('抓出重复 ID', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1'), makeLine('u2', 'Dia_ch01_001-1')],
  });
  const report = validateProject(project);
  expect(report.errors).toBe(1);
  expect(report.issues[0].code).toBe('duplicate-id');
  expect(report.issues[0].message).toContain('出现了 2 次');
});

it('抓出空的对话 ID', () => {
  const project = makeProject({ lines: [makeLine('u1', '')] });
  const report = validateProject(project);
  expect(report.issues.map((i) => i.code)).toContain('empty-id');
});

it('抓出选项指向不存在目标的跳转', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1', { kind: '选项', optionIds: ['o-a'] })],
    options: [makeOption('o-a', 'Dia_ch01_001-1A', { nextId: 'u-missing' })],
  });
  const report = validateProject(project);
  expect(report.errors).toBe(1);
  expect(report.issues[0].code).toBe('dangling-next');
  expect(report.issues[0].targetId).toBe('Dia_ch01_001-1A');
});

it('抓出引用不存在的选项', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1', { kind: '选项', optionIds: ['o-missing'] })],
  });
  const report = validateProject(project);
  expect(report.issues.map((i) => i.code)).toContain('dangling-option');
});

it('抓出孤儿选项（玩家永远看不到）', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1')],
    options: [makeOption('o-a', 'Dia_ch01_001-1A')],
  });
  const report = validateProject(project);
  expect(report.warnings).toBe(1);
  expect(report.issues[0].code).toBe('orphan-option');
});

it('被正确引用的选项不告警', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1', { kind: '选项', optionIds: ['o-a'] })],
    options: [makeOption('o-a', 'Dia_ch01_001-1A', { nextId: 'u1' })],
  });
  const report = validateProject(project);
  expect(report.issues).toEqual([]);
});

it('抓出空文本与缺失角色，且都只是告警', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1', { text: { zh: '  ', en: '', ja: '' }, characterId: '' })],
  });
  const report = validateProject(project);
  expect(report.errors).toBe(0);
  expect(report.issues.map((i) => i.code).sort()).toEqual(['empty-text', 'no-character']);
});

it('抓出跳到其他章节的选项（跳转目标只能选同一章）', () => {
  const project = makeProject({
    lines: [makeLine('u1', 'Dia_ch01_001-1', { kind: '选项', optionIds: ['o-a'] })],
    options: [makeOption('o-a', 'Dia_ch01_001-1A', { nextId: 'u-other' })],
  });
  project.chapters.push({
    uid: 'c2',
    id: 'ch02',
    title: '第二章',
    groups: [
      {
        uid: 'g2',
        id: '001',
        title: '别章段落',
        note: '',
        lines: [makeLine('u-other', 'Dia_ch02_001-1', { characterId: 'CHA_伊芙' })],
        options: [],
      },
    ],
  });

  const report = validateProject(project);
  expect(report.errors).toBe(0);
  expect(report.issues.map((i) => i.code)).toEqual(['next-outside-chapter']);
  expect(report.issues[0].message).toContain('第二章');
  expect(report.issues[0].lineUid).toBe('u1');
});

it('「指令」行只要求填了指令，不检查台词与角色', () => {
  const empty = makeProject({
    lines: [
      makeLine('u1', 'Dia_ch01_001-1', {
        kind: '指令',
        characterId: '',
        text: { zh: '', en: '', ja: '' },
      }),
    ],
  });
  expect(validateProject(empty).issues.map((i) => i.code)).toEqual(['empty-command']);

  const filled = makeProject({
    lines: [
      makeLine('u1', 'Dia_ch01_001-1', {
        kind: '指令',
        characterId: '',
        text: { zh: '', en: '', ja: '' },
        command: '剧情.特殊# SP_ch01_001',
      }),
    ],
  });
  expect(validateProject(filled).issues).toEqual([]);
});

it('「选项」行必须有选项，且不检查台词', () => {
  const empty = makeProject({
    lines: [
      makeLine('u1', 'Dia_ch01_001-1', {
        kind: '选项',
        characterId: '',
        text: { zh: '', en: '', ja: '' },
      }),
    ],
  });
  expect(validateProject(empty).issues.map((i) => i.code)).toEqual(['empty-option-list']);

  const filled = makeProject({
    lines: [
      makeLine('u1', 'Dia_ch01_001-1', {
        kind: '选项',
        characterId: '',
        text: { zh: '', en: '', ja: '' },
        optionIds: ['o-a'],
      }),
    ],
    options: [makeOption('o-a', 'Dia_ch01_001-1A', { nextId: 'u1' })],
  });
  expect(validateProject(filled).issues).toEqual([]);
});

describe('本地化校验', () => {
  it('对话与选项文本缺英文或日文时各报一条，中文还没写的不算', () => {
    const project = makeProject({
      lines: [
        makeLine('u1', 'Dia_ch01_001-1', { text: { zh: '你好', en: 'Hi', ja: 'こんにちは' } }),
        makeLine('u2', 'Dia_ch01_001-2', { text: { zh: '缺日文', en: 'No ja', ja: '' } }),
        makeLine('u3', 'Dia_ch01_001-3', { text: { zh: '', en: '', ja: '' } }),
      ],
      options: [makeOption('o-a', 'Dia_ch01_001-4A', { text: { zh: '选项', en: '', ja: '' } })],
    });

    const report = validateLocalization(project);

    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(2);
    expect(report.issues.map((i) => [i.targetId, i.message])).toEqual([
      ['TXT_Dia_ch01_001-2', '缺日文'],
      ['TXT_Dia_ch01_001-4A', '缺英文、日文'],
    ]);
    // 点这条要跳到本地化表里的那一行
    expect(report.issues.map((i) => i.localeUid)).toEqual(['u2', 'o-a']);
    expect(report.issues[0].where).toBe('序章 / 开场');
  });

  it('UI 本地化：key 为空、key 重名算错误，缺译文算建议', () => {
    const project = makeProject({ lines: [], options: [] });
    project.uiTexts = [
      { uid: 'ui-1', key: 'TXT_Widget_设置', text: { zh: '设置', en: 'Setting', ja: '設定' } },
      { uid: 'ui-2', key: 'TXT_Widget_设置', text: { zh: '设置', en: 'Setting', ja: '設定' } },
      { uid: 'ui-3', key: 'TXT_Widget_返回', text: { zh: '返回', en: '', ja: '' } },
      { uid: 'ui-4', key: '', text: { zh: '', en: '', ja: '' } },
    ];

    const report = validateLocalization(project);

    expect(report.errors).toBe(2);
    expect(report.warnings).toBe(1);
    expect(report.issues.map((i) => i.code)).toEqual([
      'duplicate-ui-key',
      'missing-translation',
      'empty-ui-key',
    ]);
    // 重名的只报一条，点它跳到第一条上
    expect(report.issues[0].targetId).toBe('TXT_Widget_设置');
    expect(report.issues[0].localeUid).toBe('ui-1');
    expect(report.issues[1].localeUid).toBe('ui-3');
    expect(report.issues[1].message).toBe('缺英文、日文');
    expect(report.issues[2].localeUid).toBe('ui-4');
  });
});
