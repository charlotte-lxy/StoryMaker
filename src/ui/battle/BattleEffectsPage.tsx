import { classPath } from '../../core/battle';
import type { Project } from '../../core/types';
import {
  addBattleRow,
  addModifier,
  removeBattleRow,
  removeModifier,
  reorderBattleRow,
  updateBattleRow,
  updateClassPrefix,
  updateModifier,
} from '../../state/battle-operations';
import { ModifierList } from './ModifierList';
import { OrderCell, useRowDrag } from './row-drag';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/** 效果表（GE）：周期与堆叠各自是一组列，表头分两层 */
export function BattleEffectsPage({ project, onChange }: Props) {
  const editorRef = useScrollMemory('battle:effects');
  const rows = project.battle.effects;
  const attributes = project.battle.attributes.map((row) => row.name.trim()).filter(Boolean);
  const drag = useRowDrag((from, to) => onChange(reorderBattleRow(project, 'effects', from, to)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>效果表（GE）</h2>
        <span className="hint">
          效果名合成 Tag「GAS.效果.效果名」。总时长填 -1 表示无限、留空表示瞬时；周期时长 0 表示不周期触发。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addBattleRow(project, 'effects'))}>
          ＋ 新增效果
        </button>
      </div>

      <div className="battle-prefix-card">
        <label className="battle-prefix-field">
          <span className="line-field-name">类名路径前缀</span>
          <input
            value={project.battle.effectClassPrefix}
            onChange={(event) => onChange(updateClassPrefix(project, 'effectClassPrefix', event.target.value))}
          />
          <span className="hint">
            GE类 = {classPath(project.battle.effectClassPrefix, 'BP_GameEffect_Base') || '（前缀为空）'}
          </span>
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">还没有效果。点右上角「＋ 新增效果」，修改器列表可以从属性表里选属性。</div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th rowSpan={2} className="cell-order" title="拖动下面的把手调整顺序，导出顺序跟着变">
                  顺序
                </th>
                <th rowSpan={2} style={{ width: 150 }}>
                  效果名
                </th>
                <th rowSpan={2} style={{ width: 220 }}>
                  效果描述
                </th>
                <th rowSpan={2} style={{ width: 170 }}>
                  类名
                </th>
                <th rowSpan={2} style={{ width: 78 }}>
                  总时长
                </th>
                <th colSpan={2}>周期</th>
                <th rowSpan={2} style={{ width: 96 }}>
                  触发后减少层数
                </th>
                <th colSpan={3}>堆叠</th>
                <th rowSpan={2} style={{ width: 360 }}>
                  修改器列表
                </th>
                <th rowSpan={2} style={{ width: 74 }}>
                  操作
                </th>
              </tr>
              <tr>
                <th style={{ width: 78 }}>周期时长</th>
                <th style={{ width: 74 }}>首次立即触发</th>
                <th style={{ width: 74 }}>最大层数</th>
                <th style={{ width: 104 }}>获得层数时刷新总时长</th>
                <th style={{ width: 104 }}>获得层数时刷新周期时长</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.uid} data-battle-uid={row.uid} {...drag.rowProps(index)}>
                  <OrderCell index={index} drag={drag} />
                  <td>
                    <input
                      value={row.name}
                      placeholder="效果名"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { name: event.target.value }))
                      }
                    />
                    {(counts.get(row.name.trim()) ?? 0) > 1 && <div className="field-error">效果名重复</div>}
                  </td>
                  <td>
                    <input
                      value={row.note}
                      placeholder="这个效果做什么，给策划看的"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { note: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.className}
                      placeholder="BP_GameEffect_Base"
                      title="蓝图类名，导出时补成 GE类 全路径"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { className: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.duration}
                      placeholder="-1"
                      title="秒；-1 无限；留空表示瞬时"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { duration: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.period}
                      placeholder="0"
                      title="秒；0 表示不周期触发"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { period: event.target.value }))
                      }
                    />
                  </td>
                  <td className="cell-check">
                    <input
                      type="checkbox"
                      title="周期是否立刻触发一次"
                      checked={row.periodImmediate}
                      onChange={(event) =>
                        onChange(
                          updateBattleRow(project, 'effects', row.uid, { periodImmediate: event.target.checked }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.reduceStacks}
                      placeholder="0"
                      title="触发一次减少几层"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { reduceStacks: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.maxStacks}
                      placeholder="1"
                      title="最多叠几层"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'effects', row.uid, { maxStacks: event.target.value }))
                      }
                    />
                  </td>
                  <td className="cell-check">
                    <input
                      type="checkbox"
                      checked={row.refreshDuration}
                      onChange={(event) =>
                        onChange(
                          updateBattleRow(project, 'effects', row.uid, { refreshDuration: event.target.checked }),
                        )
                      }
                    />
                  </td>
                  <td className="cell-check">
                    <input
                      type="checkbox"
                      checked={row.refreshPeriod}
                      onChange={(event) =>
                        onChange(
                          updateBattleRow(project, 'effects', row.uid, { refreshPeriod: event.target.checked }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <ModifierList
                      modifiers={row.modifiers}
                      attributes={attributes}
                      onAdd={() => onChange(addModifier(project, 'effects', row.uid))}
                      onRemove={(modifierUid) => onChange(removeModifier(project, 'effects', row.uid, modifierUid))}
                      onUpdate={(modifierUid, patch) =>
                        onChange(updateModifier(project, 'effects', row.uid, modifierUid, patch))
                      }
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => onChange(removeBattleRow(project, 'effects', row.uid))}>
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
