/**
 * 端到端验证多人同步：连真的 SocketServer.exe，跑两个（有时四个）真客户端。
 *
 *   pnpm exec vite-node tools/verify-collab.mts
 *
 * 前面那些测试用的都是假 WebSocket、假 send——每一层都测透了，但"拼起来"从没跑过。
 * 这个脚本补的就是那一段：真的建连接、真的广播、真的走一遍
 * hello → snapshot → patch → resolve。
 *
 * 服务端地址取自 STORYMAKER_COLLAB_URL，默认本机 1999。跑之前先把
 * SocketServer.exe 起起来，否则整个脚本会直接报"连不上"退出。
 */

import type { CollabClient } from '../src/core/collab/client';
import { createCollabClient } from '../src/core/collab/client';
import type { CollabStatus, Conflict } from '../src/core/collab/protocol';
import { resolveConflicts, resolveFirstContact } from '../src/core/collab/resolve';
import { createSyncSession, type FirstContact, type SyncBase, type SyncSession } from '../src/core/collab/session';
import type { Project } from '../src/core/types';

const WS_URL = process.env.STORYMAKER_COLLAB_URL ?? 'ws://127.0.0.1:1999';

let failed = false;
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`✓ ${label}`);
    return;
  }
  failed = true;
  console.error(`✗ ${label}${detail === '' ? '' : `：${detail}`}`);
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(40);
  }
  return false;
}

function makeProject(name: string): Project {
  return {
    version: 1,
    name,
    characters: [{ uid: 'c1', id: 'CHA_甲', name: '甲', expressions: [], actions: [] }],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    chapters: [{ uid: 'ch1', id: 'ch01', title: '第一章', groups: [] }],
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

/** 一个完整的客户端：连接 + 会话，跟界面上用的是同一套代码 */
interface Peer {
  name: string;
  client: CollabClient;
  session: SyncSession;
  doc: () => Project;
  /** 按 App 的做法改文档：克隆再改，不就地动原对象 */
  update: (fn: (draft: Project) => void) => void;
  status: () => CollabStatus;
  conflicts: Conflict[];
  resolvedCount: () => number;
  firstContact: () => FirstContact | null;
}

function makePeer(name: string, initial: Project): Peer {
  let current = initial;
  let base: SyncBase | null = null;
  const conflicts: Conflict[] = [];
  let resolved = 0;
  let firstContact: FirstContact | null = null;

  let session: SyncSession | null = null;

  const client = createCollabClient({
    url: WS_URL,
    clientId: name,
    onStatus: () => {},
    onMessage: (message) => {
      void session?.handleMessage(message);
    },
  });

  session = createSyncSession({
    clientId: name,
    getDoc: () => current,
    setDoc: (doc) => {
      current = doc as Project;
    },
    loadBase: async () => base,
    saveBase: async (next) => {
      base = next;
    },
    send: (message) => client.send(message),
    onConflicts: (list) => {
      conflicts.length = 0;
      conflicts.push(...list);
    },
    onResolved: () => {
      resolved += 1;
      conflicts.length = 0;
    },
    onFirstContact: (info) => {
      firstContact = info;
    },
  });

  const ready = session;
  return {
    name,
    client,
    session: ready,
    doc: () => current,
    update: (fn) => {
      const draft = structuredClone(current);
      fn(draft);
      current = draft;
    },
    status: () => client.status(),
    conflicts,
    resolvedCount: () => resolved,
    firstContact: () => firstContact,
  };
}

async function connect(peer: Peer): Promise<boolean> {
  peer.client.connect();
  return waitFor(() => peer.status() === 'online', 4000);
}

const peers: Peer[] = [];

try {
  console.log(`服务端：${WS_URL}`);
  console.log('');

  // ---------- 1. 两个客户端互通有无 ----------
  console.log('【1】两个客户端互通有无');
  const a = makePeer('A', makeProject('A 的项目'));
  // B 是「刚新建」的那种空项目：没有条目、名字也还是默认的。
  // 这样它才不会被判成"两边都有一份内容"而去走首次对账——那正是场景 3 要测的。
  const b = makePeer('B', makeProject('未命名项目'));
  b.update((draft) => {
    draft.characters = [];
    draft.chapters = [];
  });
  peers.push(a, b);

  if (!(await connect(a))) throw new Error(`连不上服务端 ${WS_URL}，请先启动 SocketServer.exe`);
  a.session.announce();
  await sleep(150);
  await a.session.publishLocalChange(); // 建立 A 的基准

  if (!(await connect(b))) throw new Error('B 连不上');
  b.session.announce(); // 打招呼 → A 回 snapshot
  const gotSnapshot = await waitFor(() => b.doc().chapters.length === 1);
  check(gotSnapshot, 'B 通过 hello → snapshot 拿到了 A 的内容');
  check(b.doc().name === 'A 的项目', 'B 的项目名也同步过来了', b.doc().name);

  a.update((draft) => {
    draft.characters[0].name = '改过的甲';
  });
  await a.session.publishLocalChange();
  const arrived = await waitFor(() => b.doc().characters[0]?.name === '改过的甲');
  check(arrived, 'A 的改动自动出现在 B 那边');

  await sleep(200);

  // ---------- 2. 断线 → 双方改同一处 → 重连 → 冲突 → 一方定音 ----------
  console.log('');
  console.log('【2】断线、双方改同一处、重连后冲突，再由一方定音');

  b.client.disconnect();
  await sleep(150);
  check(b.status() === 'offline', 'B 断开了');

  a.update((draft) => {
    draft.characters[0].name = 'A 的名字';
  });
  await a.session.publishLocalChange();
  await sleep(200);

  b.update((draft) => {
    draft.characters[0].name = 'B 的名字';
  });
  await b.session.publishLocalChange(); // 发不出去，基准不动，改动攒着
  check(b.conflicts.length === 0, 'B 离线期间只是攒着，还没有冲突');

  if (!(await connect(b))) throw new Error('B 重连失败');
  b.session.announce(); // 重连后补发差额，同时和 A 对账
  const conflicted = await waitFor(() => b.conflicts.length > 0, 3000);
  check(conflicted, 'B 重连后收到了冲突', `conflicts=${b.conflicts.length}`);
  check(b.doc().characters[0].name === 'B 的名字', '冲突没落地，B 自己的值还在');

  // B 裁决：采用对方的
  const decided = resolveConflicts(b.doc(), b.conflicts, ['theirs']);
  await b.session.applyResolution(decided);
  const aGotResolve = await waitFor(() => a.resolvedCount() > 0, 3000);
  check(aGotResolve, 'A 收到了裁决结果（resolve）');
  check(b.doc().characters[0].name === 'A 的名字', 'B 裁决后采用了对方的值');
  const sameAfterResolve = await waitFor(
    () => JSON.stringify(a.doc()) === JSON.stringify(b.doc()),
    3000,
  );
  check(sameAfterResolve, '裁决后两边内容完全一致');

  await sleep(200);

  // ---------- 3. 首次对账：两边都有一份内容 ----------
  console.log('');
  console.log('【3】首次对账：两边都有一份内容，都没有共同起点');

  const c = makePeer('C', makeProject('C 的项目'));
  const d = makePeer('D', makeProject('D 的项目'));
  // 让两份内容互不重叠，方便验证"两份都保留"确实是把两边合起来
  d.update((draft) => {
    draft.characters = [];
    draft.chapters = [{ uid: 'chD', id: 'ch09', title: 'D 独有的一章', groups: [] }];
  });
  peers.push(c, d);

  if (!(await connect(c))) throw new Error('C 连不上');
  c.session.announce();
  await sleep(150);
  await c.session.publishLocalChange();

  if (!(await connect(d))) throw new Error('D 连不上');
  d.session.announce();
  const asked = await waitFor(() => d.firstContact() !== null, 3000);
  check(asked, 'D 收到了首次对账的询问（两边都有内容）');
  check(d.doc().name === 'D 的项目', 'D 没有被悄悄覆盖');

  const info = d.firstContact();
  if (info !== null) {
    const merged = resolveFirstContact(d.doc(), info.remoteDoc as Project, 'both');
    await d.session.applyResolution(merged.doc);
    const cSawD = await waitFor(() => c.doc().chapters.some((chapter) => chapter.uid === 'chD'), 3000);
    check(cSawD, '选「两份都保留」后，C 那边也看到了 D 的章节');
    check(
      [...c.doc().chapters.map((chapter) => chapter.uid)].sort().join(',') === 'ch1,chD',
      '并集正确：两边的章节都在',
      c.doc().chapters.map((chapter) => chapter.uid).join(','),
    );
  }
} catch (error) {
  failed = true;
  console.error('✗ 校验过程出错：', error);
} finally {
  for (const peer of peers) {
    try {
      peer.client.disconnect();
    } catch {
      // 已经断了就算了
    }
  }
  await sleep(200);
}

if (failed) {
  console.error('');
  console.error('端到端校验没通过。');
  process.exit(1);
}

console.log('');
console.log('端到端校验通过：两个真客户端经 SocketServer 广播，能同步、能报冲突、能裁决、能对账。');
