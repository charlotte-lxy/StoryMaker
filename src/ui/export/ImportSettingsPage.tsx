import { useState } from 'react';

import type { Project } from '../../core/types';
import type { HostApi } from '../../core/host';
import {
  DEFAULT_ATTRIBUTE_CLASS_NAME,
  classPath,
  weaponClassName,
} from '../../core/battle';
import { EXPORT_SUBTABLES, folderFromAssetPath } from '../../core/export-settings';
import { specialCommandClassName } from '../../core/special-commands';
import { updateClassPrefix } from '../../state/battle-operations';
import {
  addExportSetting,
  removeExportSetting,
  updateExportSetting,
  updateSpecialCommandClassPrefix,
} from '../../state/operations';
import type { UnrealPrefs } from '../../state/prefs';
import type { UnrealConnection } from '../use-unreal-connection';
import { useScrollMemory } from '../view-memory';
import { FolderTreeDialog } from './FolderTreeDialog';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
  prefs: UnrealPrefs;
  onChangePrefs: (patch: Partial<UnrealPrefs>) => void;
  connection: UnrealConnection;
  /** 挑 .uproject 文件的能力（桌面版才有） */
  host: HostApi | undefined;
}

/** 前缀配置的五行：键、标题、示例类名 */
interface PrefixRow {
  key: 'skillClassPrefix' | 'effectClassPrefix' | 'attributeClassPrefix' | 'weaponClassPrefix';
  label: string;
  sample: string;
}

const PREFIX_ROWS: readonly PrefixRow[] = [
  { key: 'skillClassPrefix', label: '技能表的 GA类', sample: 'BP_GA_Heal' },
  { key: 'effectClassPrefix', label: '效果表的 GE类', sample: 'BP_GE_Poison' },
  { key: 'attributeClassPrefix', label: '属性表的 属性类', sample: DEFAULT_ATTRIBUTE_CLASS_NAME },
  { key: 'weaponClassPrefix', label: '武器表的 武器类', sample: weaponClassName('WEA_Test_Sniper') },
];

/** 从已有前缀里把 /Game 那一段抠出来，用来在目录树里默认选中 */
export function folderOfPrefix(prefix: string): string {
  const match = /\/Game\/[^']*/.exec(prefix);
  return match === null ? '' : match[0].replace(/\/+$/, '');
}

/** 选中的文件夹 → 前缀（前缀以 ' 开头、以 / 结尾，classPath 会接类名和 .类名_C'） */
export function prefixFromFolder(folder: string): string {
  const trimmed = folder.trim().replace(/\/+$/, '');
  return trimmed === '' ? '' : `/Script/Engine.BlueprintGeneratedClass'${trimmed}/`;
}

/**
 * Unreal 导入设置。
 *
 * 一页三块：
 *   连接   —— 填 .uproject、连上编辑器；连上之后下面两块才可配
 *   数据表 —— 一行一张 DataTable：从编辑器里选，自动带出表名和文件夹，再选内容来自哪个子表
 *   前缀   —— 每种「类名」一条前缀，从编辑器目录树里选文件夹自动拼出来
 */
export function ImportSettingsPage({
  project,
  onChange,
  prefs,
  onChangePrefs,
  connection,
  host,
}: Props) {
  const editorRef = useScrollMemory('export:settings');
  const rows = project.exportSettings;
  const connected = connection.status === 'online';
  const tables = connection.catalog?.dataTables ?? [];

  /** 正在为哪条前缀选文件夹；null 表示弹窗关着 */
  const [pickingPrefix, setPickingPrefix] = useState<PrefixRow | 'specialCommand' | null>(null);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.tableName.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  /** 数据表那一格显示的值：/Game/<folder>/<name> */
  const assetPathOf = (folder: string, tableName: string): string => {
    const id = tableName.trim();
    if (id === '') return '';
    const trimmed = folder.trim().replace(/^\/+|\/+$/g, '');
    return trimmed === '' ? `/Game/${id}` : `/Game/${trimmed}/${id}`;
  };

  const prefixValueOf = (row: PrefixRow): string => project.battle[row.key];
  const prefixValueOfSpecialCommand = (): string => project.specialCommandClassPrefix;

  const applyPrefix = (folder: string): void => {
    const prefix = prefixFromFolder(folder);
    if (pickingPrefix === 'specialCommand') {
      onChange(updateSpecialCommandClassPrefix(project, prefix));
    } else if (pickingPrefix !== null) {
      onChange(updateClassPrefix(project, pickingPrefix.key, prefix));
    }
    setPickingPrefix(null);
  };

  const currentPickFolder =
    pickingPrefix === 'specialCommand'
      ? folderOfPrefix(prefixValueOfSpecialCommand())
      : pickingPrefix === null
        ? ''
        : folderOfPrefix(prefixValueOf(pickingPrefix));

  const renderPrefixRow = (label: string, value: string, sample: string, onPick: () => void) => (
    <tr key={label}>
      <td className="prefix-name">{label}</td>
      <td>
        <div className="prefix-cell">
          <input readOnly value={value} placeholder="（还没选文件夹）" title={value} />
          <button type="button" className="mini" disabled={!connected} onClick={onPick}>
            选择文件夹…
          </button>
        </div>
        {!connected && <div className="hint">连接编辑器后才能选</div>}
      </td>
      <td className="prefix-sample" title="导出时拼出来的样子">
        {classPath(value, sample) || '（前缀为空）'}
      </td>
    </tr>
  );

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>Unreal 导入设置</h2>
        <span className="hint">
          先连编辑器，再配「哪张子表导到哪个数据表」。连不上的时候只能看，不能改。
        </span>
      </div>

      {/* ---------- 连接 ---------- */}
      <div className="battle-table-wrap">
        <table className="lines battle-table">
          <tbody>
            <tr>
              <th style={{ width: 110 }}>Unreal 项目文件</th>
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
                  disabled={host?.unreal === undefined}
                  onClick={() => {
                    void host?.unreal?.pickUproject().then((picked) => {
                      if (picked !== null) onChangePrefs({ uprojectPath: picked });
                    });
                  }}
                >
                  选择…
                </button>
              </td>
            </tr>
            <tr>
              <th>连接</th>
              <td colSpan={2}>
                <button
                  type="button"
                  className="mini"
                  disabled={!connection.available || connection.status === 'checking'}
                  onClick={() => void connection.connect()}
                >
                  {connection.status === 'checking' ? '检测中…' : '检测连接'}
                </button>{' '}
                {connection.status === 'online' && (
                  <span className="hint">
                    已连接 {connection.node?.projectName}（引擎 {connection.node?.engineVersion}）·{' '}
                    {connection.catalogLoading
                      ? '正在读取数据表…'
                      : `找到 ${tables.length} 张数据表、${connection.catalog?.folders.length ?? 0} 个文件夹`}
                    {connection.catalogError !== '' && (
                      <span className="field-error">　{connection.catalogError}</span>
                    )}
                  </span>
                )}
                {connection.status === 'offline' && (
                  <span className="field-error">{connection.message}</span>
                )}
                {connection.status === 'idle' && <span className="hint">还没检测</span>}
                {!connection.available && <span className="hint">只有桌面版能连编辑器</span>}
                {connected && !connection.catalogLoading && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="mini"
                      onClick={() => void connection.refreshCatalog()}
                    >
                      重新读取
                    </button>
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------- 数据表配置 ---------- */}
      <div className="editor-head import-prefix-head">
        <h2>数据表配置</h2>
        <span className="hint">
          一行一张 DataTable：从编辑器里选表，再选它的内容来自哪个子表。换了工程要重新选。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addExportSetting(project))}>
          ＋ 新增数据表
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          还没配数据表。点右上角「＋ 新增数据表」，连上编辑器后从下拉里选。
        </div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th style={{ width: 360 }}>数据表</th>
                <th style={{ width: 200 }}>子表</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const current = assetPathOf(row.folder, row.tableName);
                const known = tables.some((table) => table.path === current);
                return (
                  <tr
                    className="line-row"
                    key={row.uid}
                    data-export-uid={row.uid}
                    title={current}
                  >
                    <td>
                      <select
                        value={current}
                        disabled={!connected}
                        title={connected ? '选编辑器里的哪张 DataTable' : '连接编辑器后才能选'}
                        onChange={(event) => {
                          const picked = tables.find((table) => table.path === event.target.value);
                          if (picked === undefined) return;
                          onChange(
                            updateExportSetting(project, row.uid, {
                              tableName: picked.name,
                              folder: folderFromAssetPath(picked.path),
                            }),
                          );
                        }}
                      >
                        <option value="">（未选）</option>
                        {tables.map((table) => (
                          <option key={table.path} value={table.path}>
                            {table.name}　—　{table.folder}
                          </option>
                        ))}
                        {/* 项目里配过、但编辑器里已经没有了：原样列出来，别静默丢掉 */}
                        {current !== '' && !known && (
                          <option value={current}>{current}（编辑器里找不到）</option>
                        )}
                      </select>
                      {(counts.get(row.tableName.trim()) ?? 0) > 1 && (
                        <div className="field-error">数据表重复</div>
                      )}
                    </td>
                    <td>
                      <select
                        value={row.subTable}
                        title="这张数据表的内容来自哪个子表"
                        onChange={(event) =>
                          onChange(updateExportSetting(project, row.uid, { subTable: event.target.value }))
                        }
                      >
                        <option value="">（未选）</option>
                        {EXPORT_SUBTABLES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                        {/* 手改过的项目文件里可能是别的名字，原样列出来免得静默改成第一个 */}
                        {row.subTable !== '' && !EXPORT_SUBTABLES.includes(row.subTable as never) && (
                          <option value={row.subTable}>{row.subTable}（不在清单里）</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <button type="button" onClick={() => onChange(removeExportSetting(project, row.uid))}>
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- 前缀配置 ---------- */}
      <div className="editor-head import-prefix-head">
        <h2>前缀配置</h2>
        <span className="hint">
          导出的某一列是「前缀 + 类名」时，前缀在这里统一配：从编辑器的 Content 目录树里选文件夹，
          后缀 {` .<类名>_C' `}自动补上。换项目只改这一处。
        </span>
      </div>

      <div className="battle-table-wrap import-prefix-wrap">
        <table className="lines battle-table">
          <thead>
            <tr>
              <th style={{ width: 200 }}>前缀配置</th>
              <th>文件夹</th>
              <th style={{ width: 360 }} title="导出时拼出来的完整类路径">
                拼出来的样子
              </th>
            </tr>
          </thead>
          <tbody>
            {PREFIX_ROWS.map((row) =>
              renderPrefixRow(row.label, prefixValueOf(row), row.sample, () => setPickingPrefix(row)),
            )}
            {renderPrefixRow(
              '特殊指令表的 Command类',
              prefixValueOfSpecialCommand(),
              specialCommandClassName('SP_001'),
              () => setPickingPrefix('specialCommand'),
            )}
          </tbody>
        </table>
      </div>

      {pickingPrefix !== null && (
        <FolderTreeDialog
          folders={connection.catalog?.folders ?? []}
          initialPath={currentPickFolder}
          onPick={applyPrefix}
          onCancel={() => setPickingPrefix(null)}
        />
      )}
    </div>
  );
}
