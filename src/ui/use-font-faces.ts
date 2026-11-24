/**
 * 把项目里的字体加载成浏览器能用的 @font-face。
 *
 * 字体文件放在素材文件夹的 Fonts/ 里；这里读二进制、建 FontFace、注册成
 * 「显示名称」这个 family，于是任何地方写 `font-family: <显示名称>` 都能用上。
 * 读不到（文件没传、字体坏了）就跳过，界面退回默认字体。
 */

import { useEffect } from 'react';

import type { HostApi } from '../core/host';
import type { FontRow } from '../core/types';
import type { AssetLibrary } from './use-asset-library';

/** 已经注册过的字体，避免重复 add */
const registered = new Set<string>();

/** 去掉扩展名的文件名，用来在素材库里找文件 */
function baseNameOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function useFontFaces(
  host: HostApi | undefined,
  library: AssetLibrary,
  fonts: readonly FontRow[],
): void {
  useEffect(() => {
    const unreal = host?.unreal;
    if (unreal === undefined || !library.available || library.folder.trim() === '') return;
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;

    let canceled = false;
    for (const row of fonts) {
      const family = row.name.trim();
      if (family === '' || registered.has(family)) continue;

      const file = library.byId
        .get(baseNameOf(row.fileName))
        ?.find((item) => item.fileName === row.fileName && item.kind === 'font');
      if (file === undefined) continue;

      void unreal
        .readAsset(file.filePath)
        .then(async (read) => {
          if (canceled || !read.ok || read.data === undefined) return;
          try {
            const face = new FontFace(family, read.data.slice().buffer);
            await face.load();
            if (canceled) return;
            document.fonts.add(face);
            registered.add(family);
          } catch {
            // 字体文件坏了：当没导入，界面用默认字体
          }
        })
        .catch(() => undefined);
    }

    return () => {
      canceled = true;
    };
  }, [host, library, fonts]);
}
