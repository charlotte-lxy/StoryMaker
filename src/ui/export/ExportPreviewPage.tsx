import { useMemo } from 'react';

import { buildAllSheets } from '../../core/export';
import type { Project } from '../../core/types';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  /** 当前选中的子表名（左侧栏点的） */
  name: string;
}

/**
 * 导出预览。
 *
 * 子表按钮在左边的侧栏里（垂直排列，点哪个看哪个）；
 * 这里只画选中的那张子表会写进 xlsx 的内容。
 * 内容和顺序都直接取自 buildAllSheets（导出的同一处逻辑），所以预览不会和导出对不上。
 */
export function ExportPreviewPage({ project, name }: Props) {
  const editorRef = useScrollMemory('export:preview');
  const sheets = useMemo(() => buildAllSheets(project), [project]);
  const current = sheets.find((sheet) => sheet.name === name) ?? sheets[0];

  if (current === undefined) return <div className="empty-state">没有可导出的子表。</div>;

  const header = current.rows[0] ?? [];
  const body = current.rows.slice(1);

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>{current.name}</h2>
        <span className="hint">
          这里看到的就是导出到 xlsx 里的内容（表头 + 数据行），点左边的子表换一张。
        </span>
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
