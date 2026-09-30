import type { Project } from '../../core/types';
import {
  addBattleRow,
  addModifier,
  removeBattleRow,
  removeModifier,
  reorderBattleRow,
  updateBattleList,
  updateBattleRow,
  updateModifier,
} from '../../state/battle-operations';
import { MultiSelect } from '../MultiSelect';
import { ModifierList } from './ModifierList';
import { OrderCell, useRowDrag } from './row-drag';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/** 武器表：修改器列表的做法和效果表一样，技能列表和角色预设一样 */
export function BattleWeaponsPage({ project, onChange }: Props) {
  const editorRef = useScrollMemory('battle:weapons');
  const rows = project.battle.weapons;
  const attributes = project.battle.attributes
    .map((row) => ({ value: row.uid, label: row.name.trim() }))
    .filter((item) => item.label !== '');
  const skillOptions = project.battle.skills
    .map((row) => ({ value: row.uid, label: row.name.trim() }))
    .filter((item) => item.label !== '');
  const drag = useRowDrag((from, to) => onChange(reorderBattleRow(project, 'weapons', from, to)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.id.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>武器表</h2>
        <span className="hint">
          武器 ID 是导入 Unreal 的行名（如 WEA_测试-手枪）；弹匣容量填 -1 表示无限。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addBattleRow(project, 'weapons'))}>
          ＋ 新增武器
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">还没有武器。点右上角「＋ 新增武器」。</div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th className="cell-order" title="拖动下面的把手调整顺序，导出顺序跟着变">
                  顺序
                </th>
                <th style={{ width: 170 }}>武器ID</th>
                <th style={{ width: 150 }}>武器名</th>
                <th style={{ width: 200 }}>武器描述</th>
                <th style={{ width: 84 }}>弹匣容量</th>
                <th style={{ width: 84 }}>攻击速度</th>
                <th style={{ width: 340 }}>修改器列表</th>
                <th style={{ width: 230 }}>技能列表</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.uid} data-battle-uid={row.uid} {...drag.rowProps(index)}>
                  <OrderCell index={index} drag={drag} />
                  <td>
                    <input
                      value={row.id}
                      placeholder="WEA_"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { id: event.target.value }))
                      }
                    />
                    {(counts.get(row.id.trim()) ?? 0) > 1 && <div className="field-error">武器 ID 重复</div>}
                  </td>
                  <td>
                    <input
                      value={row.name}
                      placeholder="武器名"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { name: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.description}
                      placeholder="武器描述"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { description: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.magazine}
                      placeholder="-1"
                      title="-1 表示无限"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { magazine: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.attackSpeed}
                      placeholder="1"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { attackSpeed: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <ModifierList
                      modifiers={row.modifiers}
                      attributes={attributes}
                      onAdd={() => onChange(addModifier(project, 'weapons', row.uid))}
                      onRemove={(modifierUid) => onChange(removeModifier(project, 'weapons', row.uid, modifierUid))}
                      onUpdate={(modifierUid, patch) =>
                        onChange(updateModifier(project, 'weapons', row.uid, modifierUid, patch))
                      }
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.skillUids}
                      options={skillOptions}
                      placeholder="未选技能"
                      title="勾选这把武器带的技能"
                      onChange={(next) => onChange(updateBattleList(project, 'weapons', row.uid, 'skillUids', next))}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => onChange(removeBattleRow(project, 'weapons', row.uid))}>
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
