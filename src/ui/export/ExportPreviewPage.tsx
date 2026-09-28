import { useMemo, useState } from 'react';

import { buildAllSheets } from '../../core/export';
import type { Project } from '../../core/types';

interface Props {
  project: Project;
}

/**
 * 导出预览。
 *
 * 上面一排按钮是导出的全部子表，点哪个看哪个；下面的表格就是那张子表会写进 xlsx 的内容。
 * 内容和顺序都直接取自 buildAllSheets（导出的同一处逻辑），所以预览不会和导出对不上。
 */
export function ExportPreviewPage({ project }: Props) {
  const sheets = useMemo(() => buildAllSheets(project), [project]);
  const [picked, setPicked] = useState(sheets[0]?.name ?? '');
  const current = sheets.find((sheet) => sheet.name === picked) ?? sheets[0];

  if (current === undefined) return <div className="empty-state">没有可导出的子表。</div>;

  const header = current.rows[0] ?? [];
  const body = current.rows.slice(1);

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>导出预览</h2>
        <span className="hint">这里看到的就是导出到 xlsx 里的内容（表头 + 数据行），点上面的按钮换子表。</span>
      </div>

      <div className="sheet-tabs">
        {sheets.map((sheet) => (
          <button
            key={sheet.name}
            type="button"
            className={sheet.name === current.name ? 'sheet-tab active' : 'sheet-tab'}
            onClick={() => setPicked(sheet.name)}
          >
            {sheet.name}
            <span className="count">{sheet.rows.length - 1}</span>
          </button>
        ))}
      </div>

      <div className="battle-table-wrap">
        <table className="lines preview-table">
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={index}>{cell === '' ? '（行名）' : cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.length === 0 ? (
              <tr className="locale-form-note">
                <td colSpan={Math.max(header.length, 1)}>
                  这张子表除了表头还没有数据，去对应模块填上内容就会出现在这里。
                </td>
              </tr>
            ) : (
              body.map((row, rowIndex) => (
                <tr className="line-row" key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex} className={cellIndex === 0 ? 'cell-id' : ''}>
                      {row[cellIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="hint preview-count">
        共 {body.length} 行 · {header.length} 列
      </p>
    </div>
  );
}
