import { describe, expect, it } from 'vitest';

import {
  assetKey,
  candidatesToImport,
  classifyAssets,
  previousPathsOf,
  type AssetCandidate,
  type ImportedAssetRecord,
} from './imported-assets';

/** 一个当前素材 */
function candidate(ownerUid: string, id: string, size = 100, mtimeMs = 1000): AssetCandidate {
  return {
    ownerUid,
    id,
    assetPath: `/Game/a/${id}`,
    filePath: `C:\\素材\\${id}.png`,
    size,
    mtimeMs,
    kind: 'image',
  };
}

/** 把它变成一条「导入成功」的记录 */
function recordOf(item: AssetCandidate): [string, ImportedAssetRecord] {
  return [item.ownerUid, { ...item, importedAt: '2026-01-01T00:00:00.000Z' }];
}

describe('素材按条目 uid 判定', () => {
  it('没有记录的是新增', () => {
    const changes = classifyAssets([candidate('u1', 'SCE_Black')], new Map());
    expect(changes.fresh.map((item) => item.id)).toEqual(['SCE_Black']);
    expect(changes.unchanged).toEqual([]);
  });

  it('ID 没变、指纹没变就是未变', () => {
    const item = candidate('u1', 'SCE_Black');
    const changes = classifyAssets([item], new Map([recordOf(item)]));
    expect(changes.unchanged.map((i) => i.id)).toEqual(['SCE_Black']);
    expect(changes.fresh).toEqual([]);
  });

  it('指纹变了算修改', () => {
    const before = candidate('u1', 'SCE_Black', 100, 1000);
    const after = candidate('u1', 'SCE_Black', 999, 2000);
    const changes = classifyAssets([after], new Map([recordOf(before)]));
    expect(changes.modified.map((i) => i.id)).toEqual(['SCE_Black']);
  });

  it('条目改了 ID：靠 uid 认出来，算「改名」而不是新增', () => {
    const before = candidate('u1', 'SCE_Old');
    const after = candidate('u1', 'SCE_New');
    const changes = classifyAssets([after], new Map([recordOf(before)]));

    expect(changes.renamed).toHaveLength(1);
    expect(changes.renamed[0].candidate.id).toBe('SCE_New');
    expect(changes.renamed[0].previous.id).toBe('SCE_Old');
    expect(changes.renamed[0].previous.assetPath).toBe('/Game/a/SCE_Old');
    expect(changes.fresh).toEqual([]);
  });

  it('只改了分类路径（资产路径变了）也算改名：UE 里的资产要挪过去', () => {
    const before = candidate('u1', 'SCE_Black');
    const after = { ...candidate('u1', 'SCE_Black'), assetPath: '/Game/b/SCE_Black' };
    const changes = classifyAssets([after], new Map([recordOf(before)]));
    expect(changes.renamed).toHaveLength(1);
  });

  it('改名后连文件也换了：仍然算改名（导入时会改名 + 覆盖）', () => {
    const before = candidate('u1', 'SCE_Old', 100, 1000);
    const after = candidate('u1', 'SCE_New', 999, 2000);
    const changes = classifyAssets([after], new Map([recordOf(before)]));
    expect(changes.renamed).toHaveLength(1);
    expect(candidatesToImport(changes).map((item) => item.id)).toEqual(['SCE_New']);
  });

  it('记录里有、条目没了的算「已移除」', () => {
    const gone = candidate('u2', 'SCE_Gone');
    const changes = classifyAssets([], new Map([recordOf(gone)]));
    expect(changes.removed.map((item) => item.id)).toEqual(['SCE_Gone']);
  });

  it('要导的就是新增 + 修改 + 改名', () => {
    const same = candidate('u1', 'A');
    const changed = candidate('u2', 'B', 999, 2000);
    const renamed = candidate('u3', 'C2');
    const fresh = candidate('u4', 'D');

    const records = new Map([
      recordOf(same),
      recordOf(candidate('u2', 'B', 100, 1000)),
      recordOf(candidate('u3', 'C1')),
    ]);
    const changes = classifyAssets([same, changed, renamed, fresh], records);

    expect(candidatesToImport(changes).map((item) => item.id).sort()).toEqual(['B', 'C2', 'D']);
  });

  it('改名项带着「旧资产路径」出去，导入时先改名', () => {
    const before = candidate('u1', 'SCE_Old');
    const after = candidate('u1', 'SCE_New');
    const changes = classifyAssets([after], new Map([recordOf(before)]));

    const previous = previousPathsOf(changes);
    expect(previous.get('u1')).toBe('/Game/a/SCE_Old');
    expect(previous.get('不存在')).toBeUndefined();
  });

  it('音量 / 音调变了也算修改（文件本身没动）', () => {
    const before = { ...candidate('u1', 'S_wind', 100, 1000), kind: 'sound' as const, volume: 1, pitch: 1 };
    const after = { ...candidate('u1', 'S_wind', 100, 1000), kind: 'sound' as const, volume: 1.5, pitch: 1 };

    const changes = classifyAssets([after], new Map([recordOf(before)]));
    expect(changes.modified.map((item) => item.id)).toEqual(['S_wind']);
    expect(changes.unchanged).toEqual([]);
  });

  it('老记录没有音量字段时按 1.0 算，不会凭空变成「修改」', () => {
    const before = { ...candidate('u1', 'S_wind', 100, 1000), kind: 'sound' as const };
    const after = { ...candidate('u1', 'S_wind', 100, 1000), kind: 'sound' as const, volume: 1, pitch: 1 };

    const changes = classifyAssets([after], new Map([recordOf(before)]));
    expect(changes.unchanged.map((item) => item.id)).toEqual(['S_wind']);
  });

  it('路径键统一小写', () => {
    expect(assetKey('C:\\素材\\A.PNG')).toBe('c:\\素材\\a.png');
  });
});
