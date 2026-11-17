/**
 * 「这个素材已经导入过」的判定。
 *
 * 素材是磁盘上的文件，导入过一遍之后没必要每次都重传——按「路径 + 大小 + 修改时间」
 * 打指纹，指纹没变就算没动过。素材被整个文件夹覆盖时大小和时间都会变，能认出来。
 *
 * 这里只做纯计算，记录的存取在 `state/import-markers`（本机 localStorage）。
 */

/** 一个素材文件的指纹 */
export interface AssetFingerprint {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/** 导入成功后记下来的一条 */
export interface ImportedAssetRecord extends AssetFingerprint {
  /** 图片还是音效：两类各算各的，不能互相算成「已移除」 */
  kind: 'image' | 'sound';
  /** 导入时间，ISO 字符串；只在界面上显示，不参与判定 */
  importedAt: string;
}

export interface AssetChanges {
  /** 没导入过的 */
  fresh: AssetFingerprint[];
  /** 导入过、但文件被换过了 */
  modified: AssetFingerprint[];
  /** 跟上次一模一样，可以跳过 */
  unchanged: AssetFingerprint[];
  /** 记录里有、文件夹里已经没有的（不删 UE 资产，只提示） */
  removed: ImportedAssetRecord[];
}

/** 判定要用「变化了的」那些：新增 + 修改 */
export function changedFingerprints(changes: AssetChanges): AssetFingerprint[] {
  return [...changes.fresh, ...changes.modified];
}

/** 路径统一成小写做键：Windows 路径不区分大小写 */
export function assetKey(filePath: string): string {
  return filePath.toLowerCase();
}

/**
 * 把当前文件列表和导入记录比一遍，分出新增 / 修改 / 未变 / 已移除。
 *
 * 记录里那些**不属于当前素材文件夹**的条目会被忽略——换素材文件夹时不应该
 * 把上一个文件夹的记录算成「已移除」。
 */
export function classifyAssets(
  files: readonly AssetFingerprint[],
  records: ReadonlyMap<string, ImportedAssetRecord>,
): AssetChanges {
  const fresh: AssetFingerprint[] = [];
  const modified: AssetFingerprint[] = [];
  const unchanged: AssetFingerprint[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const key = assetKey(file.filePath);
    seen.add(key);
    const record = records.get(key);
    if (record === undefined) {
      fresh.push(file);
      continue;
    }
    if (record.size !== file.size || record.mtimeMs !== file.mtimeMs) {
      modified.push(file);
      continue;
    }
    unchanged.push(file);
  }

  const removed: ImportedAssetRecord[] = [];
  for (const [key, record] of records) {
    if (!seen.has(key)) removed.push(record);
  }

  return { fresh, modified, unchanged, removed };
}
