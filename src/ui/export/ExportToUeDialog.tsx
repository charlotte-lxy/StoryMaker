import { useEffect, useMemo, useState } from 'react';

import type {
  HostApi,
  UnrealImportAsset,
  UnrealImportProgress,
  UnrealImportReport,
} from '../../core/host';
import {
  candidatesToImport,
  classifyAssets,
  previousPathsOf,
  type AssetCandidate,
  type AssetChanges,
  type ImportedAssetRecord,
} from '../../core/imported-assets';
import {
  buildUnrealImportPlan,
  resolveImportAssets,
  type ResolvedImportAsset,
} from '../../core/unreal-import';
import type { Project } from '../../core/types';
import { loadImportMarkers, mergeImportMarkers } from '../../state/import-markers';
import type { UnrealPrefs } from '../../state/prefs';
import type { UnrealConnection } from '../use-unreal-connection';
import type { AssetLibrary } from '../use-asset-library';

interface Props {
  project: Project;
  prefs: UnrealPrefs;
  host: HostApi | undefined;
  library: AssetLibrary;
  connection: UnrealConnection;
  onClose: () => void;
}

type ImportMode = 'changes' | 'all';

const KIND_LABELS: Record<'table' | 'image' | 'sound', string> = {
  table: '数据表',
  image: '图片',
  sound: '音效',
};

function toRequestAssets(
  items: readonly AssetCandidate[],
  previousPaths: ReadonlyMap<string, string>,
): UnrealImportAsset[] {
  return items.map((item) => ({
    ownerUid: item.ownerUid,
    id: item.id,
    assetPath: item.assetPath,
    sourcePath: item.filePath,
    previousAssetPath: previousPaths.get(item.ownerUid),
    ...(item.volume === undefined ? {} : { volume: item.volume }),
    ...(item.pitch === undefined ? {} : { pitch: item.pitch }),
  }));
}

/**
 * 「导出到 UE」弹窗。
 *
 * 导入范围、两个按钮、进度条和结果都在这里；点「完成」关掉。
 * 素材增量、先素材后数据表这些规则和内嵌逻辑一致，只是外壳变成了弹窗。
 */
export function ExportToUeDialog({ project, prefs, host, library, connection, onClose }: Props) {
  const unreal = host?.unreal;
  const plan = useMemo(() => buildUnrealImportPlan(project), [project]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UnrealImportProgress | null>(null);
  const [report, setReport] = useState<UnrealImportReport | null>(null);
  const [markerVersion, setMarkerVersion] = useState(0);

  const folder = prefs.assetFolder.trim();
  const imageResolved = useMemo(
    () => resolveImportAssets(plan.images, library.byId, 'image'),
    [plan.images, library.byId],
  );
  const soundResolved = useMemo(
    () => resolveImportAssets(plan.sounds, library.byId, 'sound'),
    [plan.sounds, library.byId],
  );

  const markers = useMemo(() => loadImportMarkers(folder), [folder, markerVersion]);
  const imageRecords = useMemo(() => pickKind(markers, 'image'), [markers]);
  const soundRecords = useMemo(() => pickKind(markers, 'sound'), [markers]);

  const imageChanges = useMemo(
    () => classifyAssets(imageResolved.ready, imageRecords),
    [imageResolved.ready, imageRecords],
  );
  const soundChanges = useMemo(
    () => classifyAssets(soundResolved.ready, soundRecords),
    [soundResolved.ready, soundRecords],
  );

  useEffect(() => {
    if (unreal === undefined) return;
    return unreal.onImportProgress((event) => setProgress(event));
  }, [unreal]);

  // Esc 关闭：导入中不让关，免得关到一半不知道导完没有
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, running]);

  const connected = connection.status === 'online';
  const canImport = connected && unreal !== undefined && !running;
  const hasChanges =
    candidatesToImport(imageChanges).length + candidatesToImport(soundChanges).length > 0;

  const start = async (mode: ImportMode): Promise<void> => {
    if (unreal === undefined) return;
    const images = mode === 'all' ? imageResolved.ready : candidatesToImport(imageChanges);
    const sounds = mode === 'all' ? soundResolved.ready : candidatesToImport(soundChanges);

    setRunning(true);
    setReport(null);
    setProgress(null);
    try {
      const response = await unreal.runImport({
        uprojectPath: prefs.uprojectPath,
        plan: {
          tables: plan.tables.map((table) => ({
            label: table.label,
            assetPath: table.assetPath,
            csvText: table.csvText,
          })),
          images: toRequestAssets(images, previousPathsOf(imageChanges)),
          sounds: toRequestAssets(sounds, previousPathsOf(soundChanges)),
        },
      });
      setReport(response);

      const byOwner = resolvedByOwner(imageResolved.ready, soundResolved.ready);
      const records: ImportedAssetRecord[] = [];
      for (const ownerUid of response.importedOwnerUids) {
        const file = byOwner.get(ownerUid);
        if (file === undefined) continue;
        records.push({
          ownerUid: file.ownerUid,
          id: file.id,
          assetPath: file.assetPath,
          kind: file.kind,
          filePath: file.filePath,
          size: file.size,
          mtimeMs: file.mtimeMs,
          importedAt: new Date().toISOString(),
          ...(file.volume === undefined ? {} : { volume: file.volume }),
          ...(file.pitch === undefined ? {} : { pitch: file.pitch }),
        });
      }
      mergeImportMarkers(folder, records);
      if (records.length > 0) setMarkerVersion((current) => current + 1);
    } catch (error) {
      setReport({
        ok: false,
        stopped: true,
        items: [],
        importedOwnerUids: [],
        counts: { tables: 0, images: 0, sounds: 0 },
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const failures = report === null ? [] : report.items.filter((item) => !item.ok);

  return (
    <div className="modal-mask" onClick={running ? undefined : onClose}>
      <div
        className="modal export-ue-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>导出到 UE</header>
        <div className="modal-body">
          {!connected && (
            <div className="field-error">
              还没连上编辑器。先去「导出 → Unreal导入设置」里点「检测连接」。
            </div>
          )}

          <h3 className="export-ue-section">导入范围</h3>
          <table className="lines battle-table import-scope">
            <tbody>
              <tr>
                <th style={{ width: 110 }}>数据表</th>
                <td>
                  <strong>{plan.tables.length} 张</strong>
                  <span className="hint">　每次全量导入</span>
                </td>
              </tr>
              <tr>
                <th>图片</th>
                <td>
                  {folder === '' ? (
                    <span className="hint">没配素材文件夹，这次不导图片</span>
                  ) : (
                    <MaterialSummary
                      total={imageResolved.ready.length}
                      missing={imageResolved.missing.length}
                      duplicates={imageResolved.duplicates.length}
                      changes={imageChanges}
                    />
                  )}
                </td>
              </tr>
              <tr>
                <th>音效</th>
                <td>
                  {folder === '' ? (
                    <span className="hint">没配素材文件夹，这次不导音效</span>
                  ) : (
                    <MaterialSummary
                      total={soundResolved.ready.length}
                      missing={soundResolved.missing.length}
                      duplicates={soundResolved.duplicates.length}
                      changes={soundChanges}
                    />
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="import-actions">
            <button
              type="button"
              className="primary"
              disabled={!canImport}
              onClick={() => void start('changes')}
              title={hasChanges ? '只导新增、修改、改名的素材' : '没有素材变更，直接导数据表'}
            >
              导入
            </button>
            <button type="button" disabled={!canImport} onClick={() => void start('all')}>
              全量导入
            </button>
            <span className="hint">先导素材、全部成功后才导数据表；素材有一个失败就停下。</span>
          </div>

          {running && (
            <>
              <h3 className="export-ue-section">进度</h3>
              <ImportProgressBar progress={progress} />
            </>
          )}

          {report !== null && (
            <>
              <h3 className="export-ue-section">结果</h3>
              {report.message !== undefined && <div className="field-error">{report.message}</div>}
              <div className="hint">
                提交了 {report.counts.tables} 张表、{report.counts.images} 张图、
                {report.counts.sounds} 条音效。
              </div>
              {report.items.length > 0 && (
                <div className="battle-table-wrap export-ue-result">
                  <table className="lines battle-table">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>类型</th>
                        <th style={{ width: 260 }}>对象</th>
                        <th style={{ width: 60 }}>结果</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((item, index) => (
                        <tr key={`${item.kind}-${item.label}-${index}`}>
                          <td>{KIND_LABELS[item.kind]}</td>
                          <td>{item.label}</td>
                          <td>{item.ok ? '成功' : <span className="field-error">失败</span>}</td>
                          <td>{item.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {failures.length > 0 && (
                <div className="hint">失败 {failures.length} 条，修好后重新导出。</div>
              )}
            </>
          )}
        </div>
        <footer>
          <button type="button" className="primary" disabled={running} onClick={onClose}>
            {report !== null ? '完成' : '关闭'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ImportProgressBar({ progress }: { progress: UnrealImportProgress | null }) {
  if (progress === null) {
    return <div className="hint">正在连接编辑器…</div>;
  }
  const completed = progress.status === 'running' ? progress.current - 1 : progress.current;
  const percent = progress.total === 0 ? 0 : Math.round((completed / progress.total) * 100);

  return (
    <div className="import-progress">
      <div className="import-progress-head">
        <strong>{progress.phase === 'assets' ? '导入素材' : '导入数据表'}</strong>
        <span>
          {progress.current} / {progress.total}
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill${progress.status === 'failed' ? ' failed' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="hint import-progress-label">
        {progress.status === 'running' ? '正在导入：' : progress.status === 'ok' ? '已完成：' : '失败：'}
        {progress.label}
      </div>
    </div>
  );
}

function MaterialSummary({
  total,
  missing,
  duplicates,
  changes,
}: {
  total: number;
  missing: number;
  duplicates: number;
  changes: AssetChanges;
}) {
  return (
    <div className="import-summary">
      <span className="import-summary-total">{total} 个</span>
      <span className="import-chip fresh">新增 {changes.fresh.length}</span>
      <span className="import-chip modified">修改 {changes.modified.length}</span>
      {changes.renamed.length > 0 && (
        <span
          className="import-chip renamed"
          title="条目改了 ID：导入时会把素材文件和 UE 里的资产一起改名"
        >
          改名 {changes.renamed.length}
        </span>
      )}
      <span className="import-chip unchanged">未变 {changes.unchanged.length}</span>
      {changes.removed.length > 0 && (
        <span
          className="import-chip removed"
          title="素材文件夹里已经没有这些文件；UE 里的资产不会被自动删除"
        >
          已移除 {changes.removed.length}
        </span>
      )}
      {missing > 0 && (
        <span className="import-chip error" title="这些 ID 在素材文件夹里找不到对应文件">
          缺文件 {missing}
        </span>
      )}
      {duplicates > 0 && (
        <span className="import-chip error" title="同一个 ID 有多个文件，导入时用第一个">
          重复 {duplicates}
        </span>
      )}
    </div>
  );
}

function pickKind(
  markers: Map<string, ImportedAssetRecord>,
  kind: 'image' | 'sound',
): Map<string, ImportedAssetRecord> {
  const out = new Map<string, ImportedAssetRecord>();
  for (const [key, record] of markers) {
    if (record.kind === kind) out.set(key, record);
  }
  return out;
}

function resolvedByOwner(
  images: readonly ResolvedImportAsset[],
  sounds: readonly ResolvedImportAsset[],
): Map<string, ResolvedImportAsset> {
  const map = new Map<string, ResolvedImportAsset>();
  for (const item of images) map.set(item.ownerUid, item);
  for (const item of sounds) map.set(item.ownerUid, item);
  return map;
}
