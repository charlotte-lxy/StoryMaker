import { useCallback, useEffect, useState } from 'react';

import type { UpdateApi, UpdateNote, UpdateNotice } from '../core/host';

/**
 * 自动更新的界面状态。
 *
 * 真正的检查 / 下载 / 替换都在主进程里，这里只负责把结果翻译成中文状态，
 * 让设置页和启动提示共用同一份状态——下载完成后两边看到的都是「重启后生效」。
 */
export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unsupported';

export interface Updater {
  /** 当前运行的版本号（构建时从 package.json 注入） */
  version: string;
  phase: UpdaterPhase;
  latest: string;
  size: number;
  /** 从当前版本到最新版本的更新日志（新→旧） */
  notes: UpdateNote[];
  message: string;
  /** 启动时后台检查到的新版；非 null 时弹出提示 */
  notice: UpdateNotice | null;
  check: () => void;
  download: () => void;
  apply: () => void;
  dismissNotice: () => void;
}

export function useUpdater(update: UpdateApi | undefined): Updater {
  const [phase, setPhase] = useState<UpdaterPhase>(update === undefined ? 'unsupported' : 'idle');
  const [latest, setLatest] = useState('');
  const [size, setSize] = useState(0);
  const [notes, setNotes] = useState<UpdateNote[]>([]);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    setPhase(update === undefined ? 'unsupported' : 'idle');
    setNotice(null);
    setNotes([]);
    if (update === undefined) return undefined;

    return update.onAvailable((incoming) => {
      setLatest(incoming.latest);
      setSize(incoming.size);
      setNotes(incoming.notes ?? []);
      setPhase('available');
      setNotice(incoming);
    });
  }, [update]);

  const check = useCallback(() => {
    if (update === undefined) return;
    setPhase('checking');
    setMessage('');
    void update
      .check()
      .then((result) => {
        if (result.status === 'available') {
          setLatest(result.latest ?? '');
          setSize(result.size ?? 0);
          setNotes(result.notes ?? []);
          setPhase('available');
        } else if (result.status === 'latest') {
          setLatest(result.latest ?? result.current);
          setNotes([]);
          setPhase('latest');
        } else if (result.status === 'unsupported') {
          setNotes([]);
          setPhase('unsupported');
        } else {
          setNotes([]);
          setMessage(result.message ?? '连不上更新源');
          setPhase('error');
        }
      })
      .catch(() => {
        setMessage('连不上更新源');
        setPhase('error');
      });
  }, [update]);

  const download = useCallback(() => {
    if (update === undefined) return;
    setPhase('downloading');
    setMessage('');
    void update
      .download()
      .then((result) => {
        if (result.ok) {
          setPhase('ready');
        } else {
          setMessage(result.message ?? '下载失败');
          setPhase('error');
        }
      })
      .catch(() => {
        setMessage('下载失败');
        setPhase('error');
      });
  }, [update]);

  const apply = useCallback(() => {
    if (update === undefined) return;
    setPhase('downloading');
    setMessage('');
    void update
      .apply()
      .then((result) => {
        if (!result.ok) {
          setMessage(result.message ?? '安装失败');
          setPhase('error');
        }
        // 成功时主进程会退出，这里不用再改状态
      })
      .catch(() => {
        setMessage('安装失败');
        setPhase('error');
      });
  }, [update]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    phase,
    latest,
    size,
    notes,
    message,
    notice,
    check,
    download,
    apply,
    dismissNotice,
  };
}

/** 给界面看的下载大小：1.4 MB / 820 KB */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '大小未知';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
