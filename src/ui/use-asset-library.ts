/**
 * 素材文件夹的状态：扫一遍、按 ID 归类、上传与删除后自动重扫。
 *
 * 立绘和音效模块的「素材管理」列共用这一份：同一张表里几百行只扫一次，
 * 传完一个文件立刻反映到所有行上。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AssetFileInfo, HostApi } from '../core/host';

export interface AssetActionResult {
  ok: boolean;
  message?: string;
}

export interface AssetLibrary {
  /** 当前环境能不能读写素材（只有桌面版有） */
  available: boolean;
  /** 素材文件夹；空串表示还没在设置里配 */
  folder: string;
  loading: boolean;
  error: string;
  /**
   * 图片 / 音效 ID → 该 ID 下找到的文件，按文件名排序。
   *
   * 同一个 ID 有多个文件（如 png 和 jpg）时列表长度大于 1，
   * 第一个当准的（和导入时「先到先得」的规则一致），界面据长度提示重复。
   */
  byId: Map<string, AssetFileInfo[]>;
  refresh: () => void;
  /** 传素材；replace 为 true 时先删掉同 ID 的其他文件（「重新选择素材」） */
  upload: (id: string, kind: 'image' | 'sound', replace: boolean) => Promise<AssetActionResult>;
  /** 删素材文件 */
  remove: (file: AssetFileInfo) => Promise<AssetActionResult>;
}

export function useAssetLibrary(host: HostApi | undefined, folder: string): AssetLibrary {
  const unreal = host?.unreal;
  const [files, setFiles] = useState<AssetFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (unreal === undefined || folder.trim() === '') {
      setFiles([]);
      setError('');
      return;
    }

    let canceled = false;
    setLoading(true);
    void unreal
      .listAssets(folder)
      .then((result) => {
        if (canceled) return;
        setLoading(false);
        setFiles(result.ok ? result.files : []);
        setError(result.ok ? '' : (result.message ?? '读不了素材文件夹'));
      })
      .catch((reason: unknown) => {
        if (canceled) return;
        setLoading(false);
        setFiles([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      canceled = true;
    };
  }, [unreal, folder, version]);

  const byId = useMemo(() => {
    const map = new Map<string, AssetFileInfo[]>();
    for (const file of files) {
      const list = map.get(file.baseName);
      if (list === undefined) map.set(file.baseName, [file]);
      else list.push(file);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.fileName.localeCompare(right.fileName));
    }
    return map;
  }, [files]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const upload = useCallback(
    async (id: string, kind: 'image' | 'sound', replace: boolean): Promise<AssetActionResult> => {
      if (unreal === undefined) return { ok: false, message: '当前环境不能读写素材文件' };
      const result = await unreal.uploadAsset({ folder, id, kind, replace });
      if (result.ok) {
        refresh();
        return { ok: true };
      }
      if (result.canceled === true) return { ok: false };
      return { ok: false, message: result.message ?? '上传失败' };
    },
    [unreal, folder, refresh],
  );

  const remove = useCallback(
    async (file: AssetFileInfo): Promise<AssetActionResult> => {
      if (unreal === undefined) return { ok: false, message: '当前环境不能读写素材文件' };
      const result = await unreal.removeAsset(file.filePath);
      if (result.ok) {
        refresh();
        return { ok: true };
      }
      return { ok: false, message: result.message ?? '删除失败' };
    },
    [unreal, refresh],
  );

  return {
    available: unreal !== undefined,
    folder,
    loading,
    error,
    byId,
    refresh,
    upload,
    remove,
  };
}
