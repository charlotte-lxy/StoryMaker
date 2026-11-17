import { useEffect, useMemo, useState } from 'react';

import type {
  HostApi,
  UnrealImportAsset,
  UnrealImportProgress,
  UnrealImportReport,
  UnrealNodeInfo,
} from '../core/host';
import {
  assetKey,
  classifyAssets,
  changedFingerprints,
  type AssetChanges,
  type ImportedAssetRecord,
} from '../core/imported-assets';
import {
  buildUnrealImportPlan,
  resolveImportAssets,
  type ResolvedImportAsset,
} from '../core/unreal-import';
import type { Project } from '../core/types';
import { loadImportMarkers, mergeImportMarkers } from '../state/import-markers';
import type { UnrealPrefs } from '../state/prefs';
import type { AssetLibrary } from './use-asset-library';

interface Props {
  project: Project;
  prefs: UnrealPrefs;
  onChangePrefs: (patch: Partial<UnrealPrefs>) => void;
  host: HostApi | undefined;
  /** 素材文件夹里的文件；增量判定要用它的指纹 */
  library: AssetLibrary;
}

type Connection =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'online'; node: UnrealNodeInfo }
  | { kind: 'offline'; message: string };

type ImportMode = 'changes' | 'all';

const KIND_LABELS: Record<'table' | 'image' | 'sound', string> = {
  table: '数据表',
  image: '图片',
  sound: '音效',
};

/** 把解析好的素材转成请求里要的形状 */
function toRequestAssets(items: readonly ResolvedImportAsset[]): UnrealImportAsset[] {
  return items.map((item) => ({
    id: item.id,
    assetPath: item.assetPath,
    sourcePath: item.filePath,
  }));
}

/**
 * 「导入到 Unreal」页。
 *
 * 只做编排：把项目整理成导入计划，交给桌面版主进程去连编辑器、跑脚本，
 * 再把逐条结果摊给策划看。业务数据一律来自项目文件，这里不存任何东西。
 *
 * 素材支持增量：按「路径 + 大小 + 修改时间」跟本机记录比，只导新增和改动过的；
 * 但**数据表每次都全量**——表小、灌一次很快，增量反而容易漏。
 */
export function UnrealImportPage({ project, prefs, onChangePrefs, host, library }: Props) {
  const unreal = host?.unreal;
  const plan = useMemo(() => buildUnrealImportPlan(project), [project]);
  const [connection, setConnection] = useState<Connection>({ kind: 'idle' });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UnrealImportProgress | null>(null);
  const [report, setReport] = useState<UnrealImportReport | null>(null);
  /** 导入完成后要重新读一遍标记，+1 触发 */
  const [markerVersion, setMarkerVersion] = useState(0);

  const folder = prefs.assetFolder.trim();
  const imageResolved = useMemo(
    () => resolveImportAssets(plan.images, library.byId),
    [plan.images, library.byId],
  );
  const soundResolved = useMemo(
    () => resolveImportAssets(plan.sounds, library.byId),
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

  const ready = prefs.uprojectPath.trim() !== '' && unreal !== undefined && !running;

  const check = async (): Promise<void> => {
    if (unreal === undefined) return;
    setConnection({ kind: 'checking' });
    try {
      const result = await unreal.discover(prefs.uprojectPath);
      if (result.nodes.length === 0) {
        setConnection({ kind: 'offline', message: result.error ?? '没有发现在线的编辑器' });
        return;
      }
      const node = pickNode(result.nodes, prefs.uprojectPath);
      setConnection(
        node === null
          ? {
              kind: 'offline',
              message: `在线的编辑器里没有目标工程，发现的是：${result.nodes
                .map((item) => item.projectName || '（未命名）')
                .join('、')}`,
            }
          : { kind: 'online', node },
      );
    } catch (error) {
      setConnection({
        kind: 'offline',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const start = async (mode: ImportMode): Promise<void> => {
    if (unreal === undefined) return;
    const images =
      mode === 'all' ? imageResolved.ready : filterChanged(imageResolved.ready, imageChanges);
    const sounds =
      mode === 'all' ? soundResolved.ready : filterChanged(soundResolved.ready, soundChanges);

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
          images: toRequestAssets(images),
          sounds: toRequestAssets(sounds),
        },
      });
      setReport(response);

      // 记住这次导成功的素材，下次增量就跳过它们
      const byPath = resolvedFiles(imageResolved.ready, soundResolved.ready);
      const records: ImportedAssetRecord[] = [];
      for (const path of response.importedPaths) {
        const file = byPath.get(assetKey(path));
        if (file === undefined) continue;
        records.push({
          filePath: file.filePath,
          size: file.size,
          mtimeMs: file.mtimeMs,
          kind: file.kind,
          importedAt: new Date().toISOString(),
        });
      }
      mergeImportMarkers(folder, records);
      if (records.length > 0) setMarkerVersion((current) => current + 1);
    } catch (error) {
      setReport({
        ok: false,
        stopped: true,
        items: [],
        importedPaths: [],
        counts: { tables: 0, images: 0, sounds: 0 },
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const failures = report === null ? [] : report.items.filter((item) => !item.ok);
  const hasChanges =
    changedFingerprints(imageChanges).length + changedFingerprints(soundChanges).length > 0;

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>导入到 Unreal</h2>
        <span className="hint">
          打开着 Unreal 编辑器时直接导入。素材按「新增 / 修改」增量导，数据表每次全量；
          没有素材变更也能点「导入」，这时只灌数据表。
        </span>
      </div>

      {unreal === undefined && (
        <div className="empty-state">
          当前环境没有连接 Unreal 的能力：只有桌面版（StoryMaker.exe）支持，
          网页版和本地服务版走不了本机端口。
        </div>
      )}

      <section className="import-section">
        <h3>连接</h3>
        <table className="lines battle-table">
          <tbody>
            <tr>
              <th style={{ width: 140 }}>Unreal 项目文件</th>
              <td>
                <input
                  value={prefs.uprojectPath}
                  placeholder="E:\Unreal\UnrealProject\BulletShoot\BulletShootGame\BulletShootGame.uproject"
                  onChange={(event) => onChangePrefs({ uprojectPath: event.target.value })}
                />
              </td>
              <td style={{ width: 90 }}>
                <button
                  type="button"
                  className="mini"
                  disabled={unreal === undefined}
                  onClick={() => {
                    void unreal?.pickUproject().then((picked) => {
                      if (picked !== null) onChangePrefs({ uprojectPath: picked });
                    });
                  }}
                >
                  选择…
                </button>
              </td>
            </tr>
            <tr>
              <th>素材文件夹</th>
              <td colSpan={2}>
                <span className="hint">
                  {folder === ''
                    ? '还没配。去「设置」页选一个素材文件夹。'
                    : `${folder}（在「设置」页改）`}
                </span>
              </td>
            </tr>
            <tr>
              <th>状态</th>
              <td colSpan={2}>
                <button
                  type="button"
                  className="mini"
                  disabled={unreal === undefined || connection.kind === 'checking'}
                  onClick={() => void check()}
                >
                  {connection.kind === 'checking' ? '检测中…' : '检测连接'}
                </button>{' '}
                <ConnectionText connection={connection} />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="import-section">
        <h3>导入范围</h3>
        <table className="lines battle-table import-scope">
          <tbody>
            <tr>
              <th style={{ width: 140 }}>数据表</th>
              <td>
                <strong>{plan.tables.length} 张</strong>
                <span className="hint">　每次全量导入（表小，增量反而容易漏）</span>
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
            disabled={!ready}
            onClick={() => void start('changes')}
            title={
              hasChanges
                ? '只导新增和修改过的素材，然后导数据表'
                : '没有素材变更，直接导数据表'
            }
          >
            导入
          </button>
          <button type="button" disabled={!ready} onClick={() => void start('all')}>
            全量导入
          </button>
          <span className="hint">
            先导素材、全部成功后才导数据表；素材有一个失败就会停下，避免数据表引用到不存在的资产。
          </span>
        </div>
      </section>

      {running && (
        <section className="import-section">
          <h3>进度</h3>
          <ImportProgressBar progress={progress} />
        </section>
      )}

      {report !== null && (
        <section className="import-section">
          <h3>结果</h3>
          {report.message !== undefined && <div className="field-error">{report.message}</div>}
          <div className="hint">
            提交了 {report.counts.tables} 张表、{report.counts.images} 张图、{report.counts.sounds} 条音效。
          </div>
          {report.items.length > 0 && (
            <table className="lines battle-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>类型</th>
                  <th style={{ width: 300 }}>对象</th>
                  <th style={{ width: 70 }}>结果</th>
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
          )}
          {failures.length > 0 && <div className="hint">失败 {failures.length} 条，修好后重新导。</div>}
        </section>
      )}
    </div>
  );
}

/** 进度条：阶段 + 当前文件 + 第几项 / 共几项 */
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

/** 素材的增量小计 */
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
    <>
      <strong>{total} 个</strong>
      <span className="hint">
        　新增 {changes.fresh.length} / 修改 {changes.modified.length} / 未变 {changes.unchanged.length}
      </span>
      {changes.removed.length > 0 && (
        <span className="hint">
          　已移除 {changes.removed.length}（UE 里的资产不会自动删）
        </span>
      )}
      {missing > 0 && <span className="field-error">　{missing} 个找不到素材文件</span>}
      {duplicates > 0 && <span className="field-error">　{duplicates} 个有重复文件</span>}
    </>
  );
}

/** 导入记录按类别分开：图片和音效各自判定，不能互相算成「已移除」 */
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

/** 把 ready 里属于「新增 + 修改」的那些挑出来 */
function filterChanged(
  items: readonly ResolvedImportAsset[],
  changes: AssetChanges,
): ResolvedImportAsset[] {
  const keys = new Set(changedFingerprints(changes).map((file) => assetKey(file.filePath)));
  return items.filter((item) => keys.has(assetKey(item.filePath)));
}

/** 按路径索引，导入成功后照着它补记录 */
function resolvedFiles(
  images: readonly ResolvedImportAsset[],
  sounds: readonly ResolvedImportAsset[],
): Map<string, ResolvedImportAsset & { kind: 'image' | 'sound' }> {
  const map = new Map<string, ResolvedImportAsset & { kind: 'image' | 'sound' }>();
  for (const item of images) map.set(assetKey(item.filePath), { ...item, kind: 'image' });
  for (const item of sounds) map.set(assetKey(item.filePath), { ...item, kind: 'sound' });
  return map;
}

/** 按 .uproject 的项目名挑节点；只有一个在线时也认 */
function pickNode(nodes: UnrealNodeInfo[], uprojectPath: string): UnrealNodeInfo | null {
  const file = uprojectPath.split(/[\\/]/).pop() ?? '';
  const name = file.toLowerCase().endsWith('.uproject') ? file.slice(0, -'.uproject'.length) : file;
  const matched = nodes.find((node) => node.projectName.toLowerCase() === name.toLowerCase());
  if (matched !== undefined) return matched;
  return nodes.length === 1 ? nodes[0] : null;
}

function ConnectionText({ connection }: { connection: Connection }) {
  if (connection.kind === 'idle') return <span className="hint">还没检测</span>;
  if (connection.kind === 'checking') return <span className="hint">检测中…</span>;
  if (connection.kind === 'offline') return <span className="field-error">{connection.message}</span>;
  const { node } = connection;
  return (
    <span className="hint">
      已连接 {node.projectName || '（未命名工程）'}（引擎 {node.engineVersion || '未知版本'}）
    </span>
  );
}
