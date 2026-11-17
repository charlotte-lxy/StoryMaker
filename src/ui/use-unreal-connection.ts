/**
 * 和 Unreal 编辑器的连接状态 + 资产清单。
 *
 * 「Unreal 导入设置」页和「导出到 UE」弹窗共用这一份：
 * 在设置页连上之后，点导出按钮不用再等一次检测。
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  HostApi,
  UnrealCatalogTable,
  UnrealNodeInfo,
} from '../core/host';

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
  /** 检测连接（成功后顺带拉清单） */
  connect: () => Promise<void>;
  /** 只重拉清单（数据表刚在编辑器里改过时用） */
  refreshCatalog: () => Promise<void>;
}

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

export function useUnrealConnection(host: HostApi | undefined, uprojectPath: string): UnrealConnection {
  const unreal = host?.unreal;
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [node, setNode] = useState<UnrealNodeInfo | null>(null);
  const [message, setMessage] = useState('');
  const [catalog, setCatalog] = useState<UnrealCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  // 换了工程文件就当成没连过：清单也可能不是同一个工程的
  useEffect(() => {
    setStatus('idle');
    setNode(null);
    setMessage('');
    setCatalog(null);
    setCatalogError('');
  }, [uprojectPath]);

  const refreshCatalog = useCallback(async (): Promise<void> => {
    if (unreal === undefined) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const result = await unreal.queryCatalog(uprojectPath);
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
      setCatalog(null);
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogLoading(false);
    }
  }, [unreal, uprojectPath]);

  const connect = useCallback(async (): Promise<void> => {
    if (unreal === undefined) return;
    setStatus('checking');
    setMessage('');
    try {
      const result = await unreal.discover(uprojectPath);
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
        setMessage(
          `在线的编辑器里没有目标工程，发现的是：${result.nodes
            .map((item) => item.projectName || '（未命名）')
            .join('、')}`,
        );
        return;
      }
      setNode(matched);
      setStatus('online');
      await refreshCatalog();
    } catch (error) {
      setStatus('offline');
      setNode(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [unreal, uprojectPath, refreshCatalog]);

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
