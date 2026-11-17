/**
 * 和 Unreal 编辑器的连接状态 + 资产清单。
 *
 * 「Unreal 导入设置」页、「导出到 UE」弹窗、顶部那个 UE 标签共用这一份：
 * 在设置页连上之后，其他地方不用再等一次检测。
 *
 * 自动连接开着的时候会定时轻量探测（只发 ping，不拉资产清单），
 * 一旦发现编辑器上线就补拉一次清单。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  HostApi,
  UnrealCatalogTable,
  UnrealNodeInfo,
} from '../core/host';
import { DEFAULT_CONNECT_INTERVAL_SEC } from '../state/prefs';

export interface UnrealCatalog {
  dataTables: UnrealCatalogTable[];
  folders: string[];
}

export type ConnectionStatus = 'idle' | 'checking' | 'online' | 'offline';

export interface UnrealConnection {
  /** 桌面版才有连接能力 */
  available: boolean;
  status: ConnectionStatus;
  node: UnrealNodeInfo | null;
  /** 连不上时给策划看的原因 */
  message: string;
  /** 编辑器里的数据表 / 文件夹清单；连上后自动拉一次 */
  catalog: UnrealCatalog | null;
  catalogLoading: boolean;
  catalogError: string;
  /** 手动检测（会显示「检测中」并顺带拉清单） */
  connect: () => Promise<void>;
  /** 只重拉清单（数据表刚在编辑器里改过时用） */
  refreshCatalog: () => Promise<void>;
}

/** 自动探测的超时：本机 ping-pong 一般几百毫秒，给 1.2 秒足够 */
const PROBE_TIMEOUT_MS = 1200;

/** 手动检测的超时：多给一点，编辑器刚启动时可能慢 */
const CONNECT_TIMEOUT_MS = 3000;

/** 按 .uproject 的项目名挑节点；只有一个在线时也认 */
export function pickUnrealNode(
  nodes: readonly UnrealNodeInfo[],
  uprojectPath: string,
): UnrealNodeInfo | null {
  const file = uprojectPath.split(/[\\/]/).pop() ?? '';
  const name = file.toLowerCase().endsWith('.uproject') ? file.slice(0, -'.uproject'.length) : file;
  const matched = nodes.find((node) => node.projectName.toLowerCase() === name.toLowerCase());
  if (matched !== undefined) return matched;
  return nodes.length === 1 ? nodes[0] : null;
}

function describeNodes(nodes: readonly UnrealNodeInfo[]): string {
  return nodes.map((item) => item.projectName || '（未命名）').join('、');
}

export function useUnrealConnection(
  host: HostApi | undefined,
  uprojectPath: string,
  options: { autoConnect?: boolean; intervalSec?: number } = {},
): UnrealConnection {
  const unreal = host?.unreal;
  const autoConnect = options.autoConnect === true;
  const intervalSec = Math.max(1, options.intervalSec ?? DEFAULT_CONNECT_INTERVAL_SEC);

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [node, setNode] = useState<UnrealNodeInfo | null>(null);
  const [message, setMessage] = useState('');
  const [catalog, setCatalog] = useState<UnrealCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  /** 同时只跑一个探测；手动点「检测连接」时等它跑完再上 */
  const inFlight = useRef(false);
  const alive = useRef(true);
  /** 这一次连接里清单拉过没有：拉失败也别每 5 秒重试一次，交给「重新读取」 */
  const catalogAttempted = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 换了工程文件就当成没连过：清单也可能不是同一个工程的
  useEffect(() => {
    setStatus('idle');
    setNode(null);
    setMessage('');
    setCatalog(null);
    setCatalogError('');
    catalogAttempted.current = false;
  }, [uprojectPath]);

  const refreshCatalog = useCallback(async (): Promise<void> => {
    if (unreal === undefined) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const result = await unreal.queryCatalog(uprojectPath);
      if (!alive.current) return;
      if (!result.ok) {
        setCatalog(null);
        setCatalogError(result.message ?? '读不到数据表清单');
        return;
      }
      setCatalog({
        dataTables: result.dataTables ?? [],
        folders: result.folders ?? [],
      });
    } catch (error) {
      if (!alive.current) return;
      setCatalog(null);
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      if (alive.current) setCatalogLoading(false);
    }
  }, [unreal, uprojectPath]);

  const check = useCallback(
    async (timeoutMs: number, withCatalog: boolean, force: boolean): Promise<void> => {
      if (unreal === undefined) return;
      if (inFlight.current) {
        // 自动探测撞上手动点击时，手动那次等它跑完
        if (!force) return;
        while (inFlight.current) await new Promise((resolve) => setTimeout(resolve, 80));
      }
      inFlight.current = true;
      if (force) setStatus('checking');
      try {
        const result = await unreal.discover(uprojectPath, timeoutMs);
        if (!alive.current) return;

        if (result.nodes.length === 0) {
          setStatus('offline');
          setNode(null);
          setMessage(result.error ?? '没有发现在线的编辑器');
          return;
        }
        const matched = pickUnrealNode(result.nodes, uprojectPath);
        if (matched === null) {
          setStatus('offline');
          setNode(null);
          setMessage(`在线的编辑器里没有目标工程，发现的是：${describeNodes(result.nodes)}`);
          return;
        }
        setNode(matched);
        setStatus('online');
        setMessage('');
        // 手动连接、或者这一轮还没拉过清单时才拉
        if (withCatalog || !catalogAttempted.current) {
          catalogAttempted.current = true;
          await refreshCatalog();
        }
      } catch (error) {
        if (!alive.current) return;
        setStatus('offline');
        setNode(null);
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        inFlight.current = false;
      }
    },
    [unreal, uprojectPath, refreshCatalog],
  );

  const connect = useCallback(async (): Promise<void> => {
    catalogAttempted.current = false;
    await check(CONNECT_TIMEOUT_MS, true, true);
  }, [check]);

  // 自动探测：串行跑，不会把上一次堆起来
  useEffect(() => {
    if (unreal === undefined) return;
    if (!autoConnect || uprojectPath.trim() === '') return;

    void check(PROBE_TIMEOUT_MS, false, false);
    const timer = window.setInterval(() => {
      void check(PROBE_TIMEOUT_MS, false, false);
    }, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [unreal, autoConnect, intervalSec, uprojectPath, check]);

  return {
    available: unreal !== undefined,
    status,
    node,
    message,
    catalog,
    catalogLoading,
    catalogError,
    connect,
    refreshCatalog,
  };
}
