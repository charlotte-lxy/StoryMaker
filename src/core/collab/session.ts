/**
 * 同步会话：把「本地文档」「上次同步基准」「别人的改动」串起来。
 *
 * 核心概念是 base——我确信所有在线客户端都已经知道的那一版文档。它存在项目文件
 * 旁边的 <项目>.sync 里，所以关掉程序再打开也还在。
 *
 * 为什么不需要单独的「待发送队列」：离线期间改了什么，用 diff(base, 当前文档) 就能
 * 算出来。base 只在改动**真的广播出去**之后才前移，所以没发出去的改动天然留在差额里，
 * 重连后一发就补上了——少一份状态就少一处能写错的地方。
 *
 * 三条边界处理：
 *   1. 连不上就什么都不同步，编辑照常。这是常态不是故障。
 *   2. 服务端会回显自己的消息，所以收到消息先按 clientId 把自己发的滤掉。
 *   3. 首次对账（本地没有 base）时，如果两边都有一份内容，没有共同起点就没法三方合并，
 *      交给上层去问人——绝不擅自拿一边盖掉另一边。
 */

import { applyPatches, diffProject } from './merge';
import type { CollabMessage, Conflict, Patch } from './protocol';

/** 上次同步到的状态；存进 <项目>.sync */
export interface SyncBase {
  doc: unknown;
  clock: number;
}

export interface FirstContact {
  /** 服务端那边已有的内容 */
  remoteDoc: unknown;
  /** 本机打开着的这份内容 */
  localDoc: unknown;
}

export interface SyncSessionOptions {
  clientId: string;
  getDoc: () => unknown;
  setDoc: (doc: unknown) => void;
  loadBase: () => Promise<SyncBase | null>;
  saveBase: (base: SyncBase) => Promise<void>;
  /** 发一条消息；返回是否真的发出去了 */
  send: (message: CollabMessage) => boolean;
  /** 有改动两边都动过，需要人来选 */
  onConflicts: (conflicts: Conflict[]) => void;
  /**
   * 首次对账且两边都有内容。给了这个回调就由上层决定怎么办；
   * 不给则保守处理：采用服务端那一份。
   */
  onFirstContact?: (info: FirstContact) => void;
}

export interface SyncSession {
  clock: () => number;
  /** 当前基准（测试用） */
  base: () => SyncBase | null;
  /** 刚连上：打招呼，并把离线期间的差额补发出去 */
  announce: () => Promise<void>;
  /** 本地文档变了：算出与基准的差额并广播 */
  publishLocalChange: () => Promise<void>;
  /** 处理一条远端消息 */
  handleMessage: (message: CollabMessage) => Promise<void>;
}

/** 判断文档算不算"有内容"：新建的空项目只有骨架，没有条目 */
function hasContent(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  const record = doc as Record<string, unknown>;
  const arrays = ['characters', 'chapters', 'items', 'quests', 'images', 'sounds', 'commands', 'uiTexts'];
  const filledArray = arrays.some((key) => Array.isArray(record[key]) && (record[key] as unknown[]).length > 0);
  if (filledArray) return true;
  return typeof record.name === 'string' && record.name.trim() !== '' && record.name !== '未命名项目';
}

export function createSyncSession(options: SyncSessionOptions): SyncSession {
  let base: SyncBase | null = null;
  let clock = 0;
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const stored = await options.loadBase();
    if (stored !== null) {
      base = stored;
      clock = stored.clock;
    }
  }

  function advanceClock(remoteClock: number): void {
    if (Number.isFinite(remoteClock)) {
      clock = Math.max(clock, remoteClock) + 1;
    } else {
      clock += 1;
    }
  }

  function broadcastPatches(patches: Patch[]): boolean {
    if (patches.length === 0) return false;
    return options.send({
      type: 'patch',
      clientId: options.clientId,
      clock,
      patches,
    });
  }

  async function commitBase(doc: unknown): Promise<void> {
    base = { doc, clock };
    await options.saveBase(base);
  }

  return {
    clock: () => clock,
    base: () => base,

    announce: async () => {
      await ensureLoaded();
      options.send({ type: 'hello', clientId: options.clientId, clock });
      // 离线期间攒下的差额：base 没前移，所以此刻 diff 出来就是它们
      if (base === null) return;
      const doc = options.getDoc();
      const patches = diffProject(base.doc, doc);
      if (patches.length === 0) return;
      clock += 1;
      if (broadcastPatches(patches)) await commitBase(doc);
    },

    publishLocalChange: async () => {
      await ensureLoaded();
      const doc = options.getDoc();

      // 还没有基准有两种情况：本机第一次参与协作，或者连 .sync 都还没有。
      // 两种都只把当前状态定为起点，不广播——谁先连上谁的内容就是共同起点，
      // 后来的人（有基准的）自然会做合并。
      if (base === null) {
        await commitBase(doc);
        return;
      }

      const patches = diffProject(base.doc, doc);
      if (patches.length === 0) return;

      clock += 1;
      if (broadcastPatches(patches)) {
        // 只在真的发出去了之后才前移：没发出去的改动要留在差额里等重连
        await commitBase(doc);
      }
    },

    handleMessage: async (message) => {
      // 服务端会把自己的消息也回显回来，先滤掉
      if (message.clientId === options.clientId) return;
      await ensureLoaded();
      advanceClock(message.clock);

      if (message.type === 'hello') {
        // 有人刚来，把我这一版发给他当起点
        options.send({
          type: 'snapshot',
          clientId: options.clientId,
          clock,
          doc: options.getDoc(),
        });
        return;
      }

      if (message.type === 'snapshot') {
        const remoteDoc = message.doc;
        const localDoc = options.getDoc();

        if (base === null) {
          // 没有共同起点，做不到三方合并
          if (hasContent(localDoc) && hasContent(remoteDoc)) {
            if (options.onFirstContact !== undefined) {
              options.onFirstContact({ remoteDoc, localDoc });
              return; // 交给上层问人，这一轮先不动
            }
          }
          options.setDoc(remoteDoc);
          await commitBase(remoteDoc);
          return;
        }

        const mine = diffProject(base.doc, localDoc);
        const theirs = diffProject(base.doc, remoteDoc);

        if (theirs.length === 0) {
          // 对方相对基准没动过，没有要合的东西；把我这边的差额补发出去
          if (mine.length > 0) {
            clock += 1;
            if (broadcastPatches(mine)) await commitBase(localDoc);
          }
          return;
        }

        // 以本机为基底、应用对方的改动。反过来（拿对方的快照当基底再应用我的改动）
        // 一旦有冲突，我本地的内容就会被顶掉——而人的直觉是「没经过我同意的东西不该消失」，
        // 所以宁可让冲突那处保持原样、报上去等人选。
        const result = applyPatches(localDoc, theirs);
        options.setDoc(result.doc);
        if (result.conflicts.length > 0) {
          options.onConflicts(result.conflicts);
          return; // base 不动，等人来裁决
        }
        await commitBase(result.doc);
        // 让对方也知道我这边多出来的改动（他手上的 remoteDoc 还没有它们）
        const applied = diffProject(remoteDoc, result.doc);
        if (applied.length > 0) broadcastPatches(applied);
        return;
      }

      if (message.type === 'patch') {
        const patches = message.patches ?? [];
        if (patches.length === 0) return;

        const result = applyPatches(options.getDoc(), patches);
        if (result.applied > 0) options.setDoc(result.doc);
        if (result.conflicts.length > 0) {
          options.onConflicts(result.conflicts);
          return; // 有没落地的改动，base 不能前移，否则下次会把对方的改动当成我删的
        }
        // 全部落地了：这条 patch 是广播给所有人的，当前状态大家都知道了
        await commitBase(result.doc);
      }
      // bye 不做事：对方走了不影响我这边的内容
    },
  };
}
