/**
 * 「这个素材已经导入过」的判定。
 *
 * 素材跟**条目 uid** 绑定，而不是跟文件名绑定：策划把条目的 ID 改名之后，
 * 素材还是它的素材（文件跟着改名，UE 里的资产也跟着改名），不会变成「找不到素材」。
 *
 * 判定分四种：
 *   新增   —— 这个条目还没有导入记录
 *   改名   —— 条目 ID 变了（记录里的 id 和现在的不一样）
 *   修改   —— ID 没变，但文件被换过了（大小或修改时间变了）
 *   未变   —— 以上都不是
 *
 * 「已移除」是记录里有、现在条目没了的——只提示，不删 UE 资产。
 */

/** 一个素材文件的指纹 */
export interface AssetFingerprint {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/** 现在要导的一个素材 */
export interface AssetCandidate extends AssetFingerprint {
  /** 条目 uid，素材靠它认主人 */
  ownerUid: string;
  /** 当前素材名（= 文件名不含扩展名） */
  id: string;
  /** 现在要导入到的 UE 资产路径 */
  assetPath: string;
  kind: 'image' | 'sound';
  /** 音效的音量 / 音调倍率（图片没有）；改了也算素材修改 */
  volume?: number;
  pitch?: number;
}

/** 导入成功后记下来的一条 */
export interface ImportedAssetRecord extends AssetFingerprint {
  ownerUid: string;
  /** 上次导入时的素材名 */
  id: string;
  /** 上次导入到的 UE 资产路径 */
  assetPath: string;
  kind: 'image' | 'sound';
  /** 导入时间，ISO 字符串；只在界面上显示 */
  importedAt: string;
  /** 上次导入时的音量 / 音调（老记录没有，按 1.0 算） */
  volume?: number;
  pitch?: number;
}

/** 一条「ID 改过名」的记录：导入时要先把 UE 里的旧资产改名 */
export interface RenamedAsset {
  candidate: AssetCandidate;
  previous: ImportedAssetRecord;
}

export interface AssetChanges {
  fresh: AssetCandidate[];
  modified: AssetCandidate[];
  renamed: RenamedAsset[];
  unchanged: AssetCandidate[];
  /** 记录里有、现在没有的条目 */
  removed: ImportedAssetRecord[];
}

/** 路径统一成小写做键：Windows 路径不区分大小写 */
export function assetKey(filePath: string): string {
  return filePath.toLowerCase();
}

/**
 * 把当前素材和导入记录比一遍。
 *
 * 记录按 ownerUid 索引；同一份素材换了 ID，靠 uid 仍然能认出来。
 */
export function classifyAssets(
  candidates: readonly AssetCandidate[],
  records: ReadonlyMap<string, ImportedAssetRecord>,
): AssetChanges {
  const fresh: AssetCandidate[] = [];
  const modified: AssetCandidate[] = [];
  const renamed: RenamedAsset[] = [];
  const unchanged: AssetCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    seen.add(candidate.ownerUid);
    const record = records.get(candidate.ownerUid);

    if (record === undefined) {
      fresh.push(candidate);
      continue;
    }
    // 改名优先：哪怕文件内容也换了，也得先把 UE 里的旧资产改过来
    if (record.id !== candidate.id || record.assetPath !== candidate.assetPath) {
      renamed.push({ candidate, previous: record });
      continue;
    }
    if (record.filePath !== candidate.filePath) {
      // 同一个 ID 但换了个文件（比如素材文件夹挪了位置）——重新导一遍最省事
      modified.push(candidate);
      continue;
    }
    if (record.size !== candidate.size || record.mtimeMs !== candidate.mtimeMs) {
      modified.push(candidate);
      continue;
    }
    // 音量 / 音调是写在 UE 资产上的，文件没变也要重新导一遍才会生效
    if (
      (record.volume ?? 1) !== (candidate.volume ?? 1) ||
      (record.pitch ?? 1) !== (candidate.pitch ?? 1)
    ) {
      modified.push(candidate);
      continue;
    }
    unchanged.push(candidate);
  }

  const removed: ImportedAssetRecord[] = [];
  for (const [ownerUid, record] of records) {
    if (!seen.has(ownerUid)) removed.push(record);
  }

  return { fresh, modified, renamed, unchanged, removed };
}

/** 这轮真正要导的素材：新增 + 修改 + 改名 */
export function candidatesToImport(changes: AssetChanges): AssetCandidate[] {
  return [...changes.fresh, ...changes.modified, ...changes.renamed.map((item) => item.candidate)];
}

/** 改名项的「旧资产路径」查询表，导入时带着它走 */
export function previousPathsOf(changes: AssetChanges): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of changes.renamed) {
    map.set(item.candidate.ownerUid, item.previous.assetPath);
  }
  return map;
}
