import { useMemo, useState } from 'react';

import type { HostApi, UnrealImportReport, UnrealNodeInfo } from '../core/host';
import {
  buildUnrealImportPlan,
  parseImportResult,
  type ImportItemResult,
} from '../core/unreal-import';
import type { Project } from '../core/types';
import type { UnrealPrefs } from '../state/prefs';

interface Props {
  project: Project;
  prefs: UnrealPrefs;
  onChangePrefs: (patch: Partial<UnrealPrefs>) => void;
  host: HostApi | undefined;
}

type Connection =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'online'; node: UnrealNodeInfo }
  | { kind: 'offline'; message: string };

/** 导入范围的三项勾选 */
interface Scope {
  tables: boolean;
  images: boolean;
  sounds: boolean;
}

const KIND_LABELS: Record<ImportItemResult['kind'], string> = {
  table: '数据表',
  image: '图片',
  sound: '音效',
};

/**
 * 「导入到 Unreal」页。
 *
 * 只做编排：把项目整理成导入计划，交给桌面版主进程去连编辑器、跑脚本，
 * 再把逐条结果摊给策划看。业务数据一律来自项目文件，这里不存任何东西。
 */
export function UnrealImportPage({ project, prefs, onChangePrefs, host }: Props) {
  const unreal = host?.unreal;
  const plan = useMemo(() => buildUnrealImportPlan(project), [project]);
  const [connection, setConnection] = useState<Connection>({ kind: 'idle' });
  const [scope, setScope] = useState<Scope>({ tables: true, images: true, sounds: true });
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<UnrealImportReport | null>(null);

  const items = report === null ? null : parseImportResult(report.output ?? []);
  const ready =
    prefs.uprojectPath.trim() !== '' && unreal !== undefined && (scope.tables || scope.images || scope.sounds);

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
      setConnection({ kind: 'offline', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const start = async (): Promise<void> => {
    if (unreal === undefined) return;
    setRunning(true);
    setReport(null);
    try {
      const response = await unreal.runImport({
        uprojectPath: prefs.uprojectPath,
        assetFolder: prefs.assetFolder,
        scope,
        plan: {
          tables: scope.tables
            ? plan.tables.map((table) => ({
                label: table.label,
                assetPath: table.assetPath,
                csvText: table.csvText,
              }))
            : [],
          images: scope.images ? plan.images : [],
          sounds: scope.sounds ? plan.sounds : [],
        },
      });
      setReport(response);
    } catch (error) {
      setReport({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
    }
  };

  const failures = items === null ? [] : items.filter((item) => !item.ok);

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>导入到 Unreal</h2>
        <span className="hint">
          打开着 Unreal 编辑器时直接导入：数据表重新灌 CSV，图片和音频按分类路径导成资源。
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
              <td>
                <input
                  value={prefs.assetFolder}
                  placeholder="png / wav 放这里，文件名就是图片 / 音效 ID"
                  onChange={(event) => onChangePrefs({ assetFolder: event.target.value })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="mini"
                  disabled={unreal === undefined}
                  onClick={() => {
                    void unreal?.pickAssetFolder().then((picked) => {
                      if (picked !== null) onChangePrefs({ assetFolder: picked });
                    });
                  }}
                >
                  选择…
                </button>
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
        <table className="lines battle-table">
          <tbody>
            <tr>
              <th style={{ width: 140 }}>数据表</th>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={scope.tables}
                    onChange={(event) => setScope((prev) => ({ ...prev, tables: event.target.checked }))}
                  />{' '}
                  {plan.tables.length} 张（按「Unreal 导入设置」里配的那些）
                </label>
              </td>
            </tr>
            <tr>
              <th>图片</th>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={scope.images}
                    onChange={(event) => setScope((prev) => ({ ...prev, images: event.target.checked }))}
                  />{' '}
                  {plan.images.length} 张（文件名 = 图片 ID）
                </label>
              </td>
            </tr>
            <tr>
              <th>音效</th>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={scope.sounds}
                    onChange={(event) => setScope((prev) => ({ ...prev, sounds: event.target.checked }))}
                  />{' '}
                  {plan.sounds.length} 条（文件名 = 音效 ID）
                </label>
              </td>
            </tr>
          </tbody>
        </table>

        {scope.images && prefs.assetFolder.trim() === '' && (
          <div className="field-error">勾了图片 / 音效但没选素材文件夹，这部分会被跳过。</div>
        )}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="primary" disabled={!ready || running} onClick={() => void start()}>
            {running ? '导入中…（编辑器会卡一会儿，别关）' : '开始导入'}
          </button>
        </div>
      </section>

      {report !== null && (
        <section className="import-section">
          <h3>结果</h3>
          {report.message !== undefined && <div className="field-error">{report.message}</div>}
          {report.counts !== undefined && (
            <div className="hint">
              提交了 {report.counts.tables} 张表、{report.counts.images} 张图、{report.counts.sounds} 条音效。
            </div>
          )}
          {items !== null && items.length > 0 && (
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
                {items.map((item, index) => (
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
          {failures.length > 0 && (
            <div className="hint">
              失败 {failures.length} 条。UE 的原始日志在下面，报错原文通常能直接看出是哪一列对不上。
            </div>
          )}
          {report.missing !== undefined &&
            (report.missing.images.length > 0 || report.missing.sounds.length > 0) && (
              <div className="hint">
                素材文件夹里找不到这些文件名：
                {report.missing.images.length > 0 && <> 图片 {report.missing.images.join('、')}</>}
                {report.missing.sounds.length > 0 && <> 音效 {report.missing.sounds.join('、')}</>}
              </div>
            )}
          {report.output !== undefined && report.output.length > 0 && (
            <details>
              <summary>UE 原始输出（{report.output.length} 行）</summary>
              <pre className="unreal-log">{report.output.join('\n')}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
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
