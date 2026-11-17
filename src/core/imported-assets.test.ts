import { describe, expect, it } from 'vitest';

import {
  assetKey,
  changedFingerprints,
  classifyAssets,
  type ImportedAssetRecord,
} from './imported-assets';

function record(
  filePath: string,
  size: number,
  mtimeMs: number,
  kind: 'image' | 'sound' = 'image',
): [string, ImportedAssetRecord] {
  return [
    assetKey(filePath),
    { filePath, size, mtimeMs, kind, importedAt: '2026-01-01T00:00:00.000Z' },
  ];
}

describe('素材增量判定', () => {
  it('没记录的是新增，记录一样的是未变，大小或时间变了是修改', () => {
    const records = new Map([
      record('C:\\素材\\SAME.png', 100, 1000),
      record('C:\\素材\\RESIZED.png', 200, 2000),
      record('C:\\素材\\TOUCHED.png', 300, 3000),
    ]);

    const changes = classifyAssets(
      [
        { filePath: 'C:\\素材\\SAME.png', size: 100, mtimeMs: 1000 },
        { filePath: 'C:\\素材\\RESIZED.png', size: 999, mtimeMs: 2000 },
        { filePath: 'C:\\素材\\TOUCHED.png', size: 300, mtimeMs: 4000 },
        { filePath: 'C:\\素材\\BRAND_NEW.png', size: 1, mtimeMs: 1 },
      ],
      records,
    );

    expect(changes.unchanged.map((file) => file.filePath)).toEqual(['C:\\素材\\SAME.png']);
    expect(changes.modified.map((file) => file.filePath)).toEqual([
      'C:\\素材\\RESIZED.png',
      'C:\\素材\\TOUCHED.png',
    ]);
    expect(changes.fresh.map((file) => file.filePath)).toEqual(['C:\\素材\\BRAND_NEW.png']);
    expect(changes.removed).toEqual([]);
  });

  it('记录里有、文件夹里没了的就是「已移除」', () => {
    const records = new Map([
      record('C:\\素材\\GONE.png', 100, 1000),
      record('C:\\素材\\STILL_THERE.png', 100, 1000),
    ]);

    const changes = classifyAssets(
      [{ filePath: 'C:\\素材\\STILL_THERE.png', size: 100, mtimeMs: 1000 }],
      records,
    );

    expect(changes.removed.map((item) => item.filePath)).toEqual(['C:\\素材\\GONE.png']);
  });

  it('路径不区分大小写：Windows 上换了个大小写不算新文件', () => {
    const records = new Map([record('C:\\素材\\SCE_Black.png', 100, 1000)]);
    const changes = classifyAssets(
      [{ filePath: 'c:\\素材\\sce_black.PNG', size: 100, mtimeMs: 1000 }],
      records,
    );
    expect(changes.unchanged).toHaveLength(1);
    expect(changes.fresh).toHaveLength(0);
  });

  it('要导的就是新增 + 修改', () => {
    const records = new Map([record('C:\\素材\\SAME.png', 100, 1000)]);
    const changes = classifyAssets(
      [
        { filePath: 'C:\\素材\\SAME.png', size: 100, mtimeMs: 1000 },
        { filePath: 'C:\\素材\\NEW.png', size: 1, mtimeMs: 1 },
      ],
      records,
    );
    expect(changedFingerprints(changes).map((file) => file.filePath)).toEqual(['C:\\素材\\NEW.png']);
  });

  it('记录是空的时候，所有文件都算新增', () => {
    const changes = classifyAssets(
      [
        { filePath: 'C:\\素材\\A.png', size: 1, mtimeMs: 1 },
        { filePath: 'C:\\素材\\B.wav', size: 2, mtimeMs: 2 },
      ],
      new Map(),
    );
    expect(changes.fresh).toHaveLength(2);
    expect(changes.removed).toHaveLength(0);
  });
});
