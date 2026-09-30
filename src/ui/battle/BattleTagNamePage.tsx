import type { Project } from '../../core/types';
import {
  addBattleRow,
  removeBattleRow,
  reorderBattleRow,
  updateBattleRow,
} from '../../state/battle-operations';
import { OrderCell, useRowDrag } from './row-drag';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
  /** 属性表还是事件表：两张表结构一样，只是名字不一样 */
  tableKey: 'attributes' | 'events';
  title: string;
  hint: string;
  nameLabel: string;
  addLabel: string;
}

/**
 * 属性表 / 事件表：只有名字和备注两列。
 *
 * Tag 由名字合成（GAS.属性.xxx / GAS.事件.xxx），在 GameplayTags 管理器里能看到结果，
 * 所以这里不重复显示一列。
 */
export function BattleTagNamePage({
  project,
  onChange,
  tableKey,
  title,
  hint,
  nameLabel,
  addLabel,
}: Props) {
  const editorRef = useScrollMemory(`battle:${tableKey}`);
  const rows = project.battle[tableKey];
  const drag = useRowDrag((from, to) => onChange(reorderBattleRow(project, tableKey, from, to)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>{title}</h2>
        <span className="hint">{hint}</span>
        <button type="button" className="primary" onClick={() => onChange(addBattleRow(project, tableKey))}>
          {addLabel}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          还没有条目。点右上角「{addLabel}」新增，名字会自动合成 Tag。
        </div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th className="cell-order" title="拖动下面的把手调整顺序，导出顺序跟着变">
                顺序
              </th>
              <th style={{ width: '32%' }}>{nameLabel}</th>
              <th>备注</th>
              <th style={{ width: 74 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.uid} data-battle-uid={row.uid} {...drag.rowProps(index)}>
                <OrderCell index={index} drag={drag} />
                <td>
                  <input
                    value={row.name}
                    placeholder={nameLabel}
                    onChange={(event) =>
                      onChange(updateBattleRow(project, tableKey, row.uid, { name: event.target.value }))
                    }
                  />
                  {(counts.get(row.name.trim()) ?? 0) > 1 && (
                    <div className="field-error">{nameLabel}重复</div>
                  )}
                </td>
                <td>
                  <input
                    value={row.note}
                    placeholder="给自己看的备注"
                    onChange={(event) =>
                      onChange(updateBattleRow(project, tableKey, row.uid, { note: event.target.value }))
                    }
                  />
                </td>
                <td>
                  <button type="button" onClick={() => onChange(removeBattleRow(project, tableKey, row.uid))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
