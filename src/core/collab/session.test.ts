import { describe, expect, it } from 'vitest';

import type { Project } from '../types';
import type { CollabMessage, Conflict } from './protocol';
import { createSyncSession, type SyncBase } from './session';

function makeProject(name = '测试项目'): Project {
  return {
    version: 1,
    name,
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
            lines: [],
            options: [],
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

/** 刚新建、什么条目都还没有的项目——用来测「本机没有内容」的那条分支 */
function makeEmptyProject(): Project {
  const project = makeProject('未命名项目');
  project.characters = [];
  project.items = [];
  project.chapters = [];
  return project;
}

interface SetupOptions {
  doc: Project;
  base: SyncBase | null;
  sendOk?: boolean;
  clientId?: string;
}

function setup(options: SetupOptions) {
  let doc = options.doc;
  let base = options.base;
  let sendOk = options.sendOk ?? true;

  const sent: CollabMessage[] = [];
  const conflicts: Conflict[] = [];
  const firstContacts: { remoteDoc: unknown; localDoc: unknown }[] = [];

  const session = createSyncSession({
    clientId: options.clientId ?? 'me',
    getDoc: () => doc,
    setDoc: (next) => {
      doc = next as Project;
    },
    loadBase: async () => base,
    saveBase: async (next) => {
      base = next;
    },
    send: (message) => {
      if (!sendOk) return false;
      sent.push(message);
      return true;
    },
    onConflicts: (list) => conflicts.push(...list),
    onFirstContact: (info) => firstContacts.push(info),
  });

  return {
    session,
    sent,
    conflicts,
    firstContacts,
    doc: () => doc,
    baseDoc: () => (base === null ? null : (base.doc as Project)),
    base: () => base,
    setSendOk: (value: boolean) => {
      sendOk = value;
    },
    clearSent: () => {
      sent.length = 0;
    },
  };
}

const renamePatch: CollabMessage = {
  type: 'patch',
  clientId: 'other',
  clock: 3,
  patches: [{ kind: 'field', target: 'characters/c1', field: 'name', oldValue: '甲', value: '对方改的' }],
};

describe('首次参与（本地还没有基准）', () => {
  it('publishLocalChange 只把当前状态定为起点，不广播', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.publishLocalChange();

    expect(s.sent).toHaveLength(0);
    expect(s.base()).not.toBeNull();
  });

  it('announce 先打招呼', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.announce();

    expect(s.sent[0]).toMatchObject({ type: 'hello', clientId: 'me' });
  });
});

describe('广播本地改动', () => {
  it('改了字段就发出 patch，并把基准前移', async () => {
    const doc = makeProject();
    const s = setup({ doc, base: { doc: structuredClone(doc), clock: 5 } });

    s.doc().characters[0].name = '改过的';
    await s.session.publishLocalChange();

    const patchMessage = s.sent.find((message) => message.type === 'patch');
    expect(patchMessage).toBeDefined();
    expect(patchMessage?.patches).toHaveLength(1);
    expect(s.baseDoc()?.characters[0].name).toBe('改过的');
  });

  it('没有改动就不发消息', async () => {
    const doc = makeProject();
    const s = setup({ doc, base: { doc: structuredClone(doc), clock: 5 } });

    await s.session.publishLocalChange();
    expect(s.sent).toHaveLength(0);
  });

  it('发不出去时基准不前移，重连后 announce 把差额补发', async () => {
    const doc = makeProject();
    const s = setup({ doc, base: { doc: structuredClone(doc), clock: 5 } });
    s.doc().characters[0].name = '离线时改的';

    s.setSendOk(false);
    await s.session.publishLocalChange();
    expect(s.sent).toHaveLength(0);
    expect(s.baseDoc()?.characters[0].name).toBe('甲'); // 基准原地不动

    s.setSendOk(true);
    s.clearSent();
    await s.session.announce();

    const patchMessage = s.sent.find((message) => message.type === 'patch');
    expect(patchMessage).toBeDefined();
    expect(patchMessage?.patches).toHaveLength(1);
  });
});

describe('收到别人的改动', () => {
  it('我没动过：应用，基准跟着走', async () => {
    const doc = makeProject();
    const s = setup({ doc, base: { doc: structuredClone(doc), clock: 1 } });

    await s.session.handleMessage(renamePatch);

    expect(s.doc().characters[0].name).toBe('对方改的');
    expect(s.conflicts).toHaveLength(0);
    expect(s.baseDoc()?.characters[0].name).toBe('对方改的');
  });

  it('我也改过同一处：只上报冲突，两边都不动', async () => {
    const doc = makeProject();
    const s = setup({ doc, base: { doc: structuredClone(doc), clock: 1 } });
    s.doc().characters[0].name = '我改的';

    await s.session.handleMessage(renamePatch);

    expect(s.conflicts).toHaveLength(1);
    expect(s.doc().characters[0].name).toBe('我改的');
    expect(s.baseDoc()?.characters[0].name).toBe('甲'); // 基准不动，免得下次把对方的改动当成我删的
  });

  it('把自己发的消息滤掉（服务端会回显）', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.handleMessage({ type: 'hello', clientId: 'me', clock: 1 });

    expect(s.sent).toHaveLength(0);
  });

  it('收到 hello 就回一份 snapshot', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.handleMessage({ type: 'hello', clientId: 'other', clock: 1 });

    expect(s.sent[0]).toMatchObject({ type: 'snapshot', clientId: 'me' });
    expect(s.sent[0].doc).toBeDefined();
  });

  it('收到 bye 什么都不做', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.handleMessage({ type: 'bye', clientId: 'other', clock: 9 });

    expect(s.sent).toHaveLength(0);
  });
});

describe('收到完整快照', () => {
  it('我没有基准、本机也没内容：直接采用对方的', async () => {
    const s = setup({ doc: makeEmptyProject(), base: null });
    await s.session.handleMessage({
      type: 'snapshot',
      clientId: 'other',
      clock: 3,
      doc: makeProject('对方的项目'),
    });

    expect(s.doc().name).toBe('对方的项目');
    expect(s.firstContacts).toHaveLength(0);
  });

  it('我没有基准、但本机有内容：交给上层问人，绝不擅自覆盖', async () => {
    const s = setup({ doc: makeProject('我的项目'), base: null });
    await s.session.handleMessage({
      type: 'snapshot',
      clientId: 'other',
      clock: 3,
      doc: makeProject('对方的项目'),
    });

    expect(s.firstContacts).toHaveLength(1);
    expect(s.doc().name).toBe('我的项目');
  });

  it('有基准且我没有离线改动：采用对方的', async () => {
    const base = makeProject();
    const s = setup({ doc: structuredClone(base), base: { doc: structuredClone(base), clock: 1 } });

    await s.session.handleMessage({
      type: 'snapshot',
      clientId: 'other',
      clock: 3,
      doc: makeProject('对方改过名字'),
    });

    expect(s.doc().name).toBe('对方改过名字');
  });

  it('有基准且我离线改过：两边合起来，并把我的改动广播回去', async () => {
    const base = makeProject();
    const local = makeProject();
    local.characters[0].name = '我离线改的';
    const remote = makeProject();
    remote.chapters[0].title = '对方改的章节名';

    const s = setup({ doc: local, base: { doc: structuredClone(base), clock: 1 } });
    await s.session.handleMessage({ type: 'snapshot', clientId: 'other', clock: 3, doc: remote });

    expect(s.doc().characters[0].name).toBe('我离线改的');
    expect(s.doc().chapters[0].title).toBe('对方改的章节名');

    const patchMessage = s.sent.find((message) => message.type === 'patch');
    expect(patchMessage).toBeDefined();
    expect(patchMessage?.patches).toHaveLength(1);
  });

  it('有基准且双方改了同一处：冲突上报，基准不动', async () => {
    const base = makeProject();
    const local = makeProject();
    local.characters[0].name = '我离线改的';
    const remote = makeProject();
    remote.characters[0].name = '对方在线改的';

    const s = setup({ doc: local, base: { doc: structuredClone(base), clock: 1 } });
    await s.session.handleMessage({ type: 'snapshot', clientId: 'other', clock: 3, doc: remote });

    expect(s.conflicts).toHaveLength(1);
    expect(s.doc().characters[0].name).toBe('我离线改的');
    expect(s.baseDoc()?.characters[0].name).toBe('甲');
  });
});

describe('时钟', () => {
  it('收到消息后时钟会越过对方的', async () => {
    const s = setup({ doc: makeProject(), base: null });
    await s.session.handleMessage({ type: 'hello', clientId: 'other', clock: 41 });

    expect(s.session.clock()).toBeGreaterThan(41);
  });
});
