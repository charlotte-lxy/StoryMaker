/**
 * 把协作的连接与会话接到 React 上。
 *
 * 界面只需要一个对象：现在的状态、当前冲突、以及"用户点了哪个按钮"。
 * 连接是随时可断的——连不上、断开、对方不在，全都只是状态变化，编辑照常，
 * 所以这里没有任何一处会因为协作而挡住用户。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { backupPath, type HostApi } from '../core/host';
import { createCollabClient, type CollabClient } from '../core/collab/client';
import type { CollabStatus, Conflict, Patch } from '../core/collab/protocol';
import { resolveConflicts, resolveFirstContact, type ConflictChoice, type FirstContactChoice } from '../core/collab/resolve';
import {
  PRESENCE_INTERVAL_MS,
  pruneCollaborators,
  upsertCollaborator,
  type Collaborator,
} from '../core/collab/presence';
import { parseBase, serializeBase } from '../core/collab/sidecar';
import { createSyncSession, type FirstContact, type SyncSession } from '../core/collab/session';
import type { Project } from '../core/types';
import {
  COLLAB_COLORS,
  loadCollabPrefs,
  saveCollabPrefs,
  type CollabColor,
  type CollabPrefs,
} from '../state/prefs';

export interface CollabController {
  status: CollabStatus;
  /** 状态的一句话说明（地址、失败原因） */
  detail: string;
  url: string;
  /** 冲突列表；非空时界面要挡住编辑，直到用户裁决完 */
  conflicts: Conflict[];
  /** 首次对账待用户选择的内容；null 表示没有 */
  firstContact: FirstContact | null;
  /** 这次连上后对方带来的改动摘要；null 表示没有要说的 */
  mergeSummary: Patch[] | null;
  /** 关掉摘要框 */
  dismissSummary: () => void;
  /** 当前在线的成员，第一个永远是自己 */
  collaborators: Collaborator[];
  /** 本机的协作身份 */
  myName: string;
  myColor: CollabColor;
  setMyName: (name: string) => void;
  setMyColor: (color: CollabColor) => void;
  connect: (url: string) => void;
  disconnect: () => void;
  applyConflictChoices: (choices: ConflictChoice[]) => void;
  cancelMerge: () => void;
  chooseFirstContact: (choice: FirstContactChoice) => void;
}

function makeClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useCollab(options: {
  project: Project;
  setProject: (next: Project) => void;
  projectPath: string | null;
  host: HostApi | undefined;
  /** 现在开着哪个模块 */
  module: string;
  /** 光标是不是真的在输入框里——只看模块会把「人在别的窗口」也算成在编辑 */
  editing: boolean;
}): CollabController {
  const { projectPath, host } = options;

  const [status, setStatus] = useState<CollabStatus>('offline');
  const [detail, setDetail] = useState('');
  /** 协作的本机设置：地址、身份、名字、颜色 */
  const [prefs, setPrefs] = useState<CollabPrefs>(() => {
    const loaded = loadCollabPrefs();
    if (loaded.clientId !== '') return loaded;
    // 第一次参与协作：发一个固定身份，顺手随机一个颜色，免得所有人都默认红色
    const fresh: CollabPrefs = {
      ...loaded,
      clientId: makeClientId(),
      color: COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)].key,
    };
    saveCollabPrefs(fresh);
    return fresh;
  });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** 别人的心跳攒出来的名单；自己不在里面，渲染时补在最前面 */
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [firstContact, setFirstContact] = useState<FirstContact | null>(null);
  const [mergeSummary, setMergeSummary] = useState<Patch[] | null>(null);
  /** 有冲突时摘要先压在这儿，等裁决完再弹——两个对话框不能叠在一起 */
  const [pendingSummary, setPendingSummary] = useState<Patch[] | null>(null);
  /** 会话回调里要读"最新的"冲突列表，闭包会锁住旧值 */
  const conflictsRef = useRef<Conflict[]>([]);

  // 会话的回调要拿到"最新的"文档和写回函数，所以走 ref，不让闭包锁住旧值
  const projectRef = useRef(options.project);
  projectRef.current = options.project;
  const setProjectRef = useRef(options.setProject);
  setProjectRef.current = options.setProject;
  const pathRef = useRef(projectPath);
  pathRef.current = projectPath;
  const hostRef = useRef(host);
  hostRef.current = host;
  const activityRef = useRef({ module: options.module, editing: options.editing });
  activityRef.current = { module: options.module, editing: options.editing };

  const clientRef = useRef<CollabClient | null>(null);
  const sessionRef = useRef<SyncSession | null>(null);

  const disconnect = useCallback(() => {
    // 走之前喊一声，别人不用等满十五秒超时才知道我走了
    clientRef.current?.send({
      type: 'bye',
      clientId: prefsRef.current.clientId,
      clock: 0,
    });
    clientRef.current?.disconnect();
    clientRef.current = null;
    sessionRef.current = null;
    conflictsRef.current = [];
    setConflicts([]);
    setFirstContact(null);
    setMergeSummary(null);
    setPendingSummary(null);
    setCollaborators([]);
    setStatus('offline');
    setDetail('');
  }, []);

  const connect = useCallback(
    (nextUrl: string) => {
      clientRef.current?.disconnect();
      clientRef.current = null;
      sessionRef.current = null;
      conflictsRef.current = [];
      setConflicts([]);
      setFirstContact(null);
      setMergeSummary(null);
      setPendingSummary(null);

      const clientId = prefsRef.current.clientId;
      const client = createCollabClient({
        url: nextUrl,
        clientId,
        onStatus: (next, why) => {
          setStatus(next);
          setDetail(why);
          // 每次连上都重新打招呼：顺便把离线期间攒下的差额补发出去
          if (next === 'online') void sessionRef.current?.announce();
        },
        onMessage: (message) => {
          const presence = message.presence;
          if (message.type === 'presence' && presence !== undefined) {
            // 自己的回显也收下，这样"我"那一行始终是最新的
            setCollaborators((list) =>
              upsertCollaborator(list, message.clientId, presence, Date.now()),
            );
            return;
          }
          if (message.type === 'bye') {
            setCollaborators((list) => list.filter((item) => item.clientId !== message.clientId));
            return;
          }
          void sessionRef.current?.handleMessage(message);
        },
      });

      const session = createSyncSession({
        clientId,
        getDoc: () => projectRef.current,
        setDoc: (doc) => setProjectRef.current(doc as Project),
        loadBase: async () => {
          const api = hostRef.current;
          const path = pathRef.current;
          if (api === undefined || path === null) return null;
          try {
            return parseBase(await api.readSidecar(path));
          } catch {
            return null; // 读不到就当作第一次参与，不影响打开项目
          }
        },
        saveBase: async (base) => {
          const api = hostRef.current;
          const path = pathRef.current;
          if (api === undefined || path === null) return;
          try {
            await api.writeSidecar(path, serializeBase(base));
          } catch {
            // 元数据写不进去不该挡着人编辑，最多下次当第一回
          }
        },
        send: (message) => client.send(message),
        onConflicts: (list) => {
          conflictsRef.current = list;
          setConflicts(list);
        },
        onResolved: () => {
          conflictsRef.current = [];
          setConflicts([]); // 对方先裁决了，这边面板自动收掉
        },
        onFirstContact: (info) => setFirstContact(info),
        onMerged: (patches) => {
          // 有冲突就先把摘要压着：先让人处理冲突，处理完再告诉他对方带了什么过来
          if (conflictsRef.current.length > 0) setPendingSummary(patches);
          else setMergeSummary(patches);
        },
      });

      clientRef.current = client;
      sessionRef.current = session;
      client.connect();
      const next: CollabPrefs = { ...prefsRef.current, url: nextUrl, autoConnect: true };
      setPrefs(next);
      saveCollabPrefs(next);
    },
    [],
  );

  /** 自动连接：上次开着就自动接上；接不上也只是显示离线，不打扰人 */
  useEffect(() => {
    const saved = prefsRef.current;
    if (saved.autoConnect) connect(saved.url);
    return () => disconnect();
  }, [connect, disconnect]);

  /** 心跳：定期喊一声「我还在、我叫什么、什么颜色」，顺手把掉线的人剔出去 */
  useEffect(() => {
    if (status !== 'online') return;

    const tick = (): void => {
      const current = prefsRef.current;
      const activity = activityRef.current;
      clientRef.current?.send({
        type: 'presence',
        clientId: current.clientId,
        clock: 0,
        presence: {
          name: current.name,
          color: current.color,
          // 不在编辑就不报模块：人走了圆点还亮着，比不亮更误导
          module: activity.editing ? activity.module : '',
        },
      });
      setCollaborators((list) => pruneCollaborators(list, Date.now()));
    };

    tick(); // 连上就立刻喊一声，不用等第一个周期
    const timer = window.setInterval(tick, PRESENCE_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // 名字和颜色刻意不进依赖：它们跟着心跳周期带出去就行，
    // 进了依赖会让每敲一个字都重发一轮广播
  }, [status, prefs.clientId, options.module, options.editing]);

  const setMyName = useCallback((name: string) => {
    const next = { ...prefsRef.current, name };
    setPrefs(next);
    saveCollabPrefs(next);
  }, []);

  const setMyColor = useCallback((color: CollabColor) => {
    const next = { ...prefsRef.current, color };
    setPrefs(next);
    saveCollabPrefs(next);
  }, []);

  /** 名单加上自己：自己永远排第一个，界面上一眼就能找到 */
  const allCollaborators = useMemo<Collaborator[]>(() => {
    const self: Collaborator = {
      clientId: prefs.clientId,
      name: prefs.name,
      color: prefs.color,
      module: '',
      lastSeen: Date.now(),
    };
    return [self, ...collaborators.filter((item) => item.clientId !== prefs.clientId)];
  }, [collaborators, prefs.clientId, prefs.name, prefs.color]);

  /** 本地改动 → 算出与基准的差额广播出去（没有改动时内部会直接返回） */
  useEffect(() => {
    const session = sessionRef.current;
    if (session === null) return;
    void session.publishLocalChange();
  }, [options.project]);

  const applyConflictChoices = useCallback(
    (choices: ConflictChoice[]) => {
      const session = sessionRef.current;
      if (session === null) return;
      const resolved = resolveConflicts(projectRef.current, conflicts, choices);
      conflictsRef.current = [];
      setConflicts([]);
      void session.applyResolution(resolved);
      // 冲突处理完了，把刚才压着的摘要放出来
      if (pendingSummary !== null) {
        setMergeSummary(pendingSummary);
        setPendingSummary(null);
      }
    },
    [conflicts, pendingSummary],
  );

  const cancelMerge = useCallback(() => {
    setPendingSummary(null);
    const point = sessionRef.current?.rollbackPoint();
    if (point !== null && point !== undefined) {
      setProjectRef.current(point as Project);
    }
    disconnect();
  }, [disconnect]);

  const chooseFirstContact = useCallback(
    (choice: FirstContactChoice) => {
      const info = firstContact;
      const session = sessionRef.current;
      setFirstContact(null);
      if (info === null || session === null) return;

      if (choice === 'later') {
        disconnect();
        return;
      }

      const localDoc = projectRef.current;
      const remoteDoc = info.remoteDoc as Project;
      const result = resolveFirstContact(localDoc, remoteDoc, choice);

      // 被舍弃的那一份另存成备份——界面上跟用户这么承诺过，就得真写。
      // 只有两种"二选一"需要：「两份都保留」没有东西被丢，「先不同步」什么都没发生。
      const api = hostRef.current;
      const path = pathRef.current;
      if (choice !== 'both' && api !== undefined && path !== null) {
        const dropped = choice === 'remote' ? localDoc : remoteDoc;
        const target = backupPath(path, new Date());
        void api.writeBackup(target, JSON.stringify(dropped, null, 2)).catch(() => {
          setDetail(`备份没写成功（${target}），被舍弃的那份已经不在界面上了`);
        });
      }

      void session.applyResolution(result.doc);
    },
    [firstContact, disconnect],
  );

  return {
    status,
    detail,
    url: prefs.url,
    conflicts,
    firstContact,
    mergeSummary,
    dismissSummary: () => setMergeSummary(null),
    collaborators: allCollaborators,
    myName: prefs.name,
    myColor: prefs.color,
    setMyName,
    setMyColor,
    connect,
    disconnect,
    applyConflictChoices,
    cancelMerge,
    chooseFirstContact,
  };
}
