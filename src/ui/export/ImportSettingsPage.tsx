import type { Project } from '../../core/types';
import {
  addExportSetting,
  removeExportSetting,
  updateExportSetting,
} from '../../state/operations';
import { EXPORT_SUBTABLES, csvFileName, dataTableRef } from '../../core/export-settings';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/**
 * Unreal 导入设置。
 *
 * 一行 = 一张 DataTable：叫什么、放在哪个文件夹、内容来自哪个子表。
 * 「数据表引用」和「csv 文件路径」是导出时按前三个字段算出来的（原来 Excel 里的公式列），
 * 所以这里不显示、也不用手填——鼠标停在行上能看到算出来的结果。
 */
export function ImportSettingsPage({ project, onChange }: Props) {
  const rows = project.exportSettings;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.tableName.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>Unreal 导入设置</h2>
        <span className="hint">
          一行一张数据表。导出的「导入设置」子表里，行名是数据表名，另外两列
          「数据表引用」「csv文件路径」会自动算出来：引用 = /Script/Engine.DataTable'/Game/文件夹/表名.表名'，
          文件名 = TB_BSGame_子表名.csv。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addExportSetting(project))}>
          ＋ 新增数据表
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">还没有数据表。点右上角「＋ 新增数据表」，写上表名、文件夹，再选它来自哪个子表。</div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th style={{ width: 260 }}>数据表名</th>
                <th style={{ width: 320 }}>数据表文件夹路径</th>
                <th style={{ width: 200 }}>子表</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="line-row"
                  key={row.uid}
                  data-export-uid={row.uid}
                  title={`${dataTableRef(row.folder, row.tableName)}\n${csvFileName(row.subTable)}`}
                >
                  <td>
                    <input
                      value={row.tableName}
                      placeholder="TB_"
                      onChange={(event) =>
                        onChange(updateExportSetting(project, row.uid, { tableName: event.target.value }))
                      }
                    />
                    {(counts.get(row.tableName.trim()) ?? 0) > 1 && (
                      <div className="field-error">数据表名重复</div>
                    )}
                  </td>
                  <td>
                    <input
                      value={row.folder}
                      placeholder="GameContent/BP/…"
                      onChange={(event) =>
                        onChange(updateExportSetting(project, row.uid, { folder: event.target.value }))
                      }
                    />
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
