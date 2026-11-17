/**
 * 「哪些素材已经导入过」的本机记录。
 *
 * 存在 localStorage，按素材文件夹分组、按**条目 uid** 索引：
 * 策划把条目 ID 改名后，素材还是同一个素材，记录不会丢。
 *
 * 记录只是用来省掉重复导入，丢了也不影响正确性（顶多全量重导一次）。
 * 版本号 v2：老版本是按文件路径记的，没法迁移，直接作废重来。
 */

import type { ImportedAssetRecord } from '../core/imported-assets';

const KEY = 'storymaker.unreal.imported.v2';

/** 素材文件夹 → 条目 uid → 记录 */
type MarkerStore = Record<string, Record<string, ImportedAssetRecord>>;

function readStore(): MarkerStore {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as MarkerStore;
  } catch {
    // 存坏了就当成没记过，下次全量导一遍
    return {};
  }
}

function writeStore(store: MarkerStore): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 存储写满时不影响导入本身，只是下次要重导
  }
}

/** 取某个素材文件夹的导入记录，键是条目 uid */
export function loadImportMarkers(folder: string): Map<string, ImportedAssetRecord> {
  const store = readStore();
  const entries = store[folder] ?? {};
  const markers = new Map<string, ImportedAssetRecord>();
  for (const [ownerUid, record] of Object.entries(entries)) {
    if (record === null || typeof record !== 'object') continue;
    markers.set(ownerUid, record);
  }
  return markers;
}

/** 把刚导入成功的素材合并进记录 */
export function mergeImportMarkers(folder: string, records: readonly ImportedAssetRecord[]): void {
  if (folder === '' || records.length === 0) return;
  const store = readStore();
  const entries = { ...(store[folder] ?? {}) };
  for (const record of records) {
    entries[record.ownerUid] = record;
  }
  store[folder] = entries;
  writeStore(store);
}
