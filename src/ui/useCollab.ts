/**
 * 把协作的连接与会话接到 React 上。
 *
 * 界面只需要一个对象：现在的状态、当前冲突、以及"用户点了哪个按钮"。
 * 连接是随时可断的——连不上、断开、对方不在，全都只是状态变化，编辑照常，
 * 所以这里没有任何一处会因为协作而挡住用户。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { HostApi } from '../core/host';
import { createCollabClient, type CollabClient } from '../core/collab/client';
import type { CollabStatus, Conflict } from '../core/collab/protocol';
import { resolveConflicts, resolveFirstContact, type ConflictChoice, type FirstContactChoice } from '../core/collab/resolve';
import { parseBase, serializeBase } from '../core/collab/sidecar';
import { createSyncSession, type FirstContact, type SyncSession } from '../core/collab/session';
import type { Project } from '../core/types';
import { loadCollabPrefs, saveCollabPrefs } from '../state/prefs';

export interface CollabController {
  status: CollabStatus;
  /** 状态的一句话说明（地址、失败原因） */
  detail: string;
  url: string;
  /** 冲突列表；非空时界面要挡住编辑，直到用户裁决完 */
  conflicts: Conflict[];
  /** 首次对账待用户选择的内容；null 表示没有 */
  firstContact: FirstContact | null;
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
}): CollabController {
  const { projectPath, host } = options;

  const [status, setStatus] = useState<CollabStatus>('offline');
  const [detail, setDetail] = useState('');
  const [url, setUrl] = useState(() => loadCollabPrefs().url);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [firstContact, setFirstContact] = useState<FirstContact | null>(null);

  // 会话的回调要拿到"最新的"文档和写回函数，所以走 ref，不让闭包锁住旧值
  const projectRef = useRef(options.project);
  projectRef.current = options.project;
  const setProjectRef = useRef(options.setProject);
  setProjectRef.current = options.setProject;
  const pathRef = useRef(projectPath);
  pathRef.current = projectPath;
  const hostRef = useRef(host);
  hostRef.current = host;

  const clientRef = useRef<CollabClient | null>(null);
  const sessionRef = useRef<SyncSession | null>(null);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    sessionRef.current = null;
    setConflicts([]);
    setFirstContact(null);
    setStatus('offline');
    setDetail('');
  }, []);

  const connect = useCallback(
    (nextUrl: string) => {
      clientRef.current?.disconnect();
      clientRef.current = null;
      sessionRef.current = null;
      setConflicts([]);
      setFirstContact(null);

      const clientId = makeClientId();
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
        onConflicts: (list) => setConflicts(list),
        onResolved: () => setConflicts([]), // 对方先裁决了，这边面板自动收掉
        onFirstContact: (info) => setFirstContact(info),
      });

      clientRef.current = client;
      sessionRef.current = session;
      client.connect();
      setUrl(nextUrl);
      saveCollabPrefs({ url: nextUrl, autoConnect: true });
    },
    [],
  );

  /** 自动连接：上次开着就自动接上；接不上也只是显示离线，不打扰人 */
  useEffect(() => {
    const prefs = loadCollabPrefs();
    if (prefs.autoConnect) connect(prefs.url);
    return () => disconnect();
  }, [connect, disconnect]);

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
      setConflicts([]);
      void session.applyResolution(resolved);
    },
    [conflicts],
  );

  const cancelMerge = useCallback(() => {
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

      const result = resolveFirstContact(projectRef.current, info.remoteDoc as Project, choice);
      void session.applyResolution(result.doc);
    },
    [firstContact, disconnect],
  );

  return {
    status,
    detail,
    url,
    conflicts,
    firstContact,
    connect,
    disconnect,
    applyConflictChoices,
    cancelMerge,
    chooseFirstContact,
  };
}
