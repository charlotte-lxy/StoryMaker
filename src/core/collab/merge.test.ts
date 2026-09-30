import { describe, expect, it } from 'vitest';

import type { Line, Project } from '../types';
import { applyPatches, deepEqual, diffProject } from './merge';
import type { FieldPatch } from './protocol';

function makeLine(uid: string, zh: string): Line {
  return {
    uid,
    readableId: `Dia_${uid}`,
    kind: '对话',
    characterUid: 'c1',
    displayName: '',
    text: { zh, en: 'Hi', ja: 'こんにちは' },
    autoAdvance: false,
    jumpGroupUid: null,
    jumpConditions: [],
    command: '',
    optionIds: [],
    note: '',
  };
}

function makeProject(): Project {
  return {
    version: 1,
    name: '测试项目',
    characters: [{ uid: 'c1', id: 'CHA_甲', name: '甲', expressions: [], actions: [] }],
    items: [{ uid: 'i1', id: 'Item_Coin', name: '金币' }],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    chapters: [
      {
        uid: 'ch1',
        id: 'ch01',
        title: '第一章',
        groups: [
          {
            uid: 'g1',
            id: '001',
            title: '开场',
            note: '',
            lines: [makeLine('l1', '你好')],
            options: [
              {
                uid: 'o1',
                readableId: 'Opt_o1',
                text: { zh: '选项', en: 'Opt', ja: '選択' },
                nextId: '',
                appearConditions: [],
                enableConditions: [],
                results: [],
              },
            ],
          },
        ],
      },
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

function fieldPatch(target: string, field: string, oldValue: unknown, value: unknown): FieldPatch {
  return { kind: 'field', target, field, oldValue, value };
}

describe('applyPatches：无冲突', () => {
  it('我没动过的字段，对方的改动直接进来', () => {
    const local = makeProject();
    const result = applyPatches(local, [fieldPatch('characters/c1', 'name', '甲', '乙')]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(1);
    expect(result.doc.characters[0].name).toBe('乙');
  });

  it('传入的文档不会被就地改动', () => {
    const local = makeProject();
    applyPatches(local, [fieldPatch('characters/c1', 'name', '甲', '乙')]);

    expect(local.characters[0].name).toBe('甲');
  });

  it('两个人分别改中英文，互不干扰', () => {
    const local = makeProject();
    local.chapters[0].groups[0].lines[0].text.zh = '我改的中文';

    const result = applyPatches(local, [
      fieldPatch('chapters/ch1/groups/g1/lines/l1', 'text.en', 'Hi', 'Hello'),
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toBe(1);
    const line = result.doc.chapters[0].groups[0].lines[0];
    expect(line.text.zh).toBe('我改的中文');
    expect(line.text.en).toBe('Hello');
  });

  it('顶层字段（项目名）也能同步', () => {
    const local = makeProject();
    const result = applyPatches(local, [fieldPatch('', 'name', '测试项目', '正式项目')]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.doc.name).toBe('正式项目');
  });
});

describe('applyPatches：冲突', () => {
  it('同一个字段两边都改了：记成冲突，且不动本地值', () => {
    const local = makeProject();
    local.characters[0].name = '我改的';

    const result = applyPatches(local, [fieldPatch('characters/c1', 'name', '甲', '对方改的')]);

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe('both-changed');
    expect(result.conflicts[0].localValue).toBe('我改的');
    expect(result.doc.characters[0].name).toBe('我改的');
  });

  it('目标条目在本地已经不存在：报 target-missing', () => {
    const local = makeProject();
    local.characters = [];

    const result = applyPatches(local, [fieldPatch('characters/c1', 'name', '甲', '乙')]);

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe('target-missing');
  });

  it('一条冲突不会影响同一批里其他能应用的改动', () => {
    const local = makeProject();
    local.characters[0].name = '我改的';

    const result = applyPatches(local, [
      fieldPatch('characters/c1', 'name', '甲', '对方改的'),
      fieldPatch('chapters/ch1', 'title', '第一章', '序章'),
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.applied).toBe(1);
    expect(result.doc.chapters[0].title).toBe('序章');
    expect(result.doc.characters[0].name).toBe('我改的');
  });
});

describe('applyPatches：幂等', () => {
  it('本地已经是对方的新值：跳过，不算冲突', () => {
    const local = makeProject();
    local.characters[0].name = '乙';

    const result = applyPatches(local, [fieldPatch('characters/c1', 'name', '甲', '乙')]);

    expect(result.skipped).toBe(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('同一批 patch 连应用两次，结果一样且第二次不报冲突', () => {
    const base = makeProject();
    const current = makeProject();
    current.name = '新名字';
    current.chapters[0].groups[0].lines[0].text.zh = '改过的台词';

    const patches = diffProject(base, current);
    const once = applyPatches(base, patches);
    const twice = applyPatches(once.doc, patches);

    expect(once.conflicts).toHaveLength(0);
    expect(twice.conflicts).toHaveLength(0);
    expect(deepEqual(twice.doc, once.doc)).toBe(true);
  });

  it('删除时本地已经删掉了：跳过', () => {
    const local = makeProject();
    local.items = [];

    const result = applyPatches(local, [
      { kind: 'remove', target: 'items/i1', oldValue: { uid: 'i1', id: 'Item_Coin', name: '金币' } },
    ]);

    expect(result.skipped).toBe(1);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe('applyPatches：增删与顺序', () => {
  it('新增一条', () => {
    const local = makeProject();
    const result = applyPatches(local, [
      { kind: 'add', collection: 'items', item: { uid: 'i2', id: 'Item_Gem', name: '宝石' } },
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.doc.items.map((item) => item.uid)).toEqual(['i1', 'i2']);
  });

  it('新增时 uid 已经存在：跳过（重复投递）', () => {
    const local = makeProject();
    const result = applyPatches(local, [
      { kind: 'add', collection: 'items', item: { uid: 'i1', id: 'Item_Coin', name: '金币' } },
    ]);

    expect(result.skipped).toBe(1);
    expect(result.doc.items).toHaveLength(1);
  });

  it('删除一条', () => {
    const local = makeProject();
    const result = applyPatches(local, [
      { kind: 'remove', target: 'items/i1', oldValue: { uid: 'i1', id: 'Item_Coin', name: '金币' } },
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.doc.items).toHaveLength(0);
  });

  it('删除时本地那条已经被改过：算冲突，别硬删', () => {
    const local = makeProject();
    local.items[0].name = '我改过的金币';

    const result = applyPatches(local, [
      { kind: 'remove', target: 'items/i1', oldValue: { uid: 'i1', id: 'Item_Coin', name: '金币' } },
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.doc.items).toHaveLength(1);
  });

  it('调整顺序（拖拽排序）', () => {
    const local = makeProject();
    local.chapters[0].groups[0].lines = [makeLine('l1', '一'), makeLine('l2', '二'), makeLine('l3', '三')];

    const result = applyPatches(local, [
      { kind: 'reorder', collection: 'chapters/ch1/groups/g1/lines', oldOrder: ['l1', 'l2', 'l3'], order: ['l3', 'l1', 'l2'] },
    ]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.doc.chapters[0].groups[0].lines.map((line) => line.uid)).toEqual(['l3', 'l1', 'l2']);
  });

  it('顺序两边都动过：算冲突', () => {
    const local = makeProject();
    // 本地排成了第三种：既不是对方的 oldOrder，也不是对方要的 order
    local.chapters[0].groups[0].lines = [makeLine('l3', '三'), makeLine('l1', '一'), makeLine('l2', '二')];

    const result = applyPatches(local, [
      {
        kind: 'reorder',
        collection: 'chapters/ch1/groups/g1/lines',
        oldOrder: ['l1', 'l2', 'l3'],
        order: ['l2', 'l1', 'l3'],
      },
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe('both-changed');
  });
});

describe('diffProject', () => {
  it('没有任何改动时，产出空列表', () => {
    expect(diffProject(makeProject(), makeProject())).toHaveLength(0);
  });

  it('改顶层字段会被识别', () => {
    const base = makeProject();
    const current = makeProject();
    current.name = '改过的名字';

    expect(diffProject(base, current)).toEqual([fieldPatch('', 'name', '测试项目', '改过的名字')]);
  });

  it('改嵌套三层里的台词会被识别，且路径带 uid', () => {
    const base = makeProject();
    const current = makeProject();
    current.chapters[0].groups[0].lines[0].text.zh = '新台词';

    const patches = diffProject(base, current);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      kind: 'field',
      target: 'chapters/ch1/groups/g1/lines/l1',
      field: 'text.zh',
      oldValue: '你好',
      value: '新台词',
    });
  });

  it('新增和删除条目都会被识别', () => {
    const base = makeProject();
    const current = makeProject();
    current.items.push({ uid: 'i2', id: 'Item_Gem', name: '宝石' });
    current.characters = [];

    const patches = diffProject(base, current);
    const kinds = patches.map((patch) => patch.kind).sort();
    expect(kinds).toEqual(['add', 'remove']);
  });

  it('纯新增/删除不会顺带产出 reorder（那会给对面造假冲突）', () => {
    const base = makeProject();
    const current = makeProject();
    current.items.push({ uid: 'i2', id: 'Item_Gem', name: '宝石' });

    expect(diffProject(base, current).map((patch) => patch.kind)).toEqual(['add']);
  });

  it('顺序变化会被识别成 reorder', () => {
    const base = makeProject();
    base.chapters[0].groups[0].lines = [makeLine('l1', '一'), makeLine('l2', '二')];
    const current = makeProject();
    current.chapters[0].groups[0].lines = [makeLine('l2', '二'), makeLine('l1', '一')];

    const reorder = diffProject(base, current).find((patch) => patch.kind === 'reorder');
    expect(reorder).toMatchObject({
      kind: 'reorder',
      collection: 'chapters/ch1/groups/g1/lines',
      oldOrder: ['l1', 'l2'],
      order: ['l2', 'l1'],
    });
  });
});

describe('diff → apply 往返', () => {
  it('把 diff 的结果应用回 base，得到和 current 完全一致的文档', () => {
    const base = makeProject();
    const current = makeProject();
    current.name = '往返测试';
    current.characters[0].name = '乙';
    current.chapters[0].title = '序章';
    current.chapters[0].groups[0].lines[0].text.zh = '改过的台词';
    current.chapters[0].groups[0].lines.push(makeLine('l2', '第二句'));
    current.chapters[0].groups[0].options.push({
      uid: 'o2',
      readableId: 'Opt_o2',
      text: { zh: '第二个选项', en: 'Second', ja: '二番' },
      nextId: '',
      appearConditions: [],
      enableConditions: [],
      results: [],
    });
    current.items = [];

    const patches = diffProject(base, current);
    const result = applyPatches(base, patches);

    expect(result.conflicts).toHaveLength(0);
    expect(deepEqual(result.doc, current)).toBe(true);
  });

  it('在中间插入新条目：新条目应该落在原位，不是被丢到末尾', () => {
    const base = makeProject();
    base.chapters[0].groups[0].lines = [
      makeLine('l1', '一'),
      makeLine('l2', '二'),
      makeLine('l3', '三'),
      makeLine('l4', '四'),
    ];
    const current = makeProject();
    current.chapters[0].groups[0].lines = [
      makeLine('l1', '一'),
      makeLine('l2', '二'),
      makeLine('l9', '插进来的'),
      makeLine('l3', '三'),
      makeLine('l4', '四'),
    ];

    const patches = diffProject(base, current);
    const result = applyPatches(base, patches);

    expect(result.conflicts).toHaveLength(0);
    expect(deepEqual(result.doc, current)).toBe(true);
  });

  it('只有顺序变化时也能往返', () => {
    const base = makeProject();
    base.chapters[0].groups[0].lines = [makeLine('l1', '一'), makeLine('l2', '二'), makeLine('l3', '三')];
    const current = makeProject();
    current.chapters[0].groups[0].lines = [makeLine('l3', '三'), makeLine('l1', '一'), makeLine('l2', '二')];

    const patches = diffProject(base, current);
    const result = applyPatches(base, patches);

    expect(result.conflicts).toHaveLength(0);
    expect(deepEqual(result.doc, current)).toBe(true);
  });
});
