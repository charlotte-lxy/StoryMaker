import { describe, expect, it } from 'vitest';

import type { Project } from '../types';
import type { Conflict } from './protocol';
import { resolveConflicts, resolveFirstContact } from './resolve';

function makeProject(name = '测试项目'): Project {
  return {
    version: 1,
    name,
    characters: [{ uid: 'c1', id: 'CHA_甲', name: '甲', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: [], actions: [] }],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    chapters: [
      { uid: 'ch1', id: 'ch01', title: '第一章', groups: [] },
    ],
    variables: [],
    uiTexts: [],
    battle: {
      skillClassPrefix: '',
      effectClassPrefix: '',
      attributes: [],
      effects: [],
      skills: [],
      events: [],
      characters: [],
      weapons: [],
    },
    exportSettings: [],
  };
}

function renameConflict(remoteName: string, localName: string): Conflict {
  return {
    patch: {
      kind: 'field',
      target: 'characters/c1',
      field: 'name',
      oldValue: '甲',
      value: remoteName,
    },
    localValue: localName,
    reason: 'both-changed',
  };
}

describe('resolveConflicts', () => {
  it('全选「用我的」时文档原样不动', () => {
    const doc = makeProject();
    doc.characters[0].name = '我的名字';

    const result = resolveConflicts(doc, [renameConflict('对方的名字', '我的名字')], ['mine']);

    expect(result.characters[0].name).toBe('我的名字');
  });

  it('全选「用对方」时对方的值落地', () => {
    const doc = makeProject();
    doc.characters[0].name = '我的名字';

    const result = resolveConflicts(doc, [renameConflict('对方的名字', '我的名字')], ['theirs']);

    expect(result.characters[0].name).toBe('对方的名字');
  });

  it('逐条混选时各按各的来', () => {
    const doc = makeProject();
    doc.name = '我的项目名';
    doc.characters[0].name = '我的角色名';

    const conflicts: Conflict[] = [
      renameConflict('对方的角色名', '我的角色名'),
      {
        patch: { kind: 'field', target: '', field: 'name', oldValue: '测试项目', value: '对方的项目名' },
        localValue: '我的项目名',
        reason: 'both-changed',
      },
    ];

    const result = resolveConflicts(doc, conflicts, ['theirs', 'mine']);

    expect(result.characters[0].name).toBe('对方的角色名');
    expect(result.name).toBe('我的项目名');
  });

  it('传入的文档不会被就地修改', () => {
    const doc = makeProject();
    doc.characters[0].name = '我的名字';
    resolveConflicts(doc, [renameConflict('对方的名字', '我的名字')], ['theirs']);

    expect(doc.characters[0].name).toBe('我的名字');
  });

  it('没有冲突时不做事', () => {
    const doc = makeProject();
    expect(resolveConflicts(doc, [], [])).toEqual(doc);
  });
});

describe('resolveFirstContact', () => {
  it('用服务端那份：采用远端，不广播', () => {
    const local = makeProject('我的项目');
    const remote = makeProject('服务端的项目');

    const result = resolveFirstContact(local, remote, 'remote');

    expect(result.doc.name).toBe('服务端的项目');
    expect(result.broadcast).toBe(false);
  });

  it('用本机那份：保留本机，广播上去', () => {
    const local = makeProject('我的项目');
    const remote = makeProject('服务端的项目');

    const result = resolveFirstContact(local, remote, 'local');

    expect(result.doc.name).toBe('我的项目');
    expect(result.broadcast).toBe(true);
  });

  it('先不同步：本机原样不动，也不广播', () => {
    const local = makeProject('我的项目');
    const remote = makeProject('服务端的项目');

    const result = resolveFirstContact(local, remote, 'later');

    expect(result.doc.name).toBe('我的项目');
    expect(result.broadcast).toBe(false);
  });

  it('两份都保留：两边的条目都留下，uid 相同的以服务端为准', () => {
    const local = makeProject('我的项目');
    local.characters.push({ uid: 'c3', id: 'CHA_丙', name: '丙', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: [], actions: [] });
    local.chapters.push({ uid: 'ch3', id: 'ch03', title: '我这边独有的章节', groups: [] });

    const remote = makeProject('服务端的项目');
    remote.characters[0] = { uid: 'c1', id: 'CHA_甲', name: '服务端那边的甲', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: [], actions: [] };
    remote.characters.push({ uid: 'c2', id: 'CHA_乙', name: '乙', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: [], actions: [] });
    remote.chapters.push({ uid: 'ch2', id: 'ch02', title: '服务端独有的章节', groups: [] });

    const result = resolveFirstContact(local, remote, 'both');
    const merged = result.doc;

    // 服务端独有的留下
    expect(merged.chapters.map((chapter) => chapter.uid)).toContain('ch2');
    // 我独有的也留下
    expect(merged.chapters.map((chapter) => chapter.uid)).toContain('ch3');
    // uid 相同的以服务端为准
    expect(merged.characters.find((item) => item.uid === 'c1')?.name).toBe('服务端那边的甲');
    // 两边不同的角色都在
    expect(merged.characters.map((item) => item.uid).sort()).toEqual(['c1', 'c2', 'c3']);
    // 广播出去，让服务端也变成这份并集
    expect(result.broadcast).toBe(true);
  });
});
