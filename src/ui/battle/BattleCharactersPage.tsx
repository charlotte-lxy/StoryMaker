import type { Project } from '../../core/types';
import {
  addBattleRow,
  addPair,
  removeBattleRow,
  removePair,
  reorderBattleRow,
  updateBattleList,
  updateBattleRow,
  updatePair,
} from '../../state/battle-operations';
import { MultiSelect } from '../MultiSelect';
import { PairList } from './PairList';
import { OrderCell, useRowDrag } from './row-drag';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/** 角色预设：属性数值 + 技能列表，导出成 GAS角色，行名就是角色 ID */
export function BattleCharactersPage({ project, onChange }: Props) {
  const editorRef = useScrollMemory('battle:characters');
  const rows = project.battle.characters;
  // 属性 / 技能两格的候选都带上 uid：存的是引用，改名字不会断
  const attributeOptions = project.battle.attributes
    .map((row) => ({ value: row.uid, label: row.name.trim() }))
    .filter((item) => item.label !== '');
  const skillOptions = project.battle.skills
    .map((row) => ({ value: row.uid, label: row.name.trim() }))
    .filter((item) => item.label !== '');
  const drag = useRowDrag((from, to) => onChange(reorderBattleRow(project, 'characters', from, to)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.id.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>角色预设</h2>
        <span className="hint">
          角色 ID 是导入 Unreal 的行名（如 CHA_测试主角）；属性列表从属性表里选属性，技能列表从技能表里多选。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addBattleRow(project, 'characters'))}>
          ＋ 新增角色
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">还没有角色预设。点右上角「＋ 新增角色」。</div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th className="cell-order" title="拖动下面的把手调整顺序，导出顺序跟着变">
                  顺序
                </th>
                <th style={{ width: 170 }}>角色ID</th>
                <th style={{ width: 170 }}>角色名</th>
                <th style={{ width: 330 }}>属性列表</th>
                <th style={{ width: 260 }}>技能列表</th>
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
                      placeholder="CHA_"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'characters', row.uid, { id: event.target.value }))
                      }
                    />
                    {(counts.get(row.id.trim()) ?? 0) > 1 && <div className="field-error">角色 ID 重复</div>}
                  </td>
                  <td>
                    <input
                      value={row.name}
                      placeholder="角色名"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'characters', row.uid, { name: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <PairList
                      pairs={row.attributes}
                      keyOptions={attributeOptions}
                      keyPlaceholder="选属性"
                      valuePlaceholder="数值"
                      addLabel="＋ 添加属性"
                      onAdd={() => onChange(addPair(project, 'characters', row.uid))}
                      onRemove={(pairUid) => onChange(removePair(project, 'characters', row.uid, pairUid))}
                      onUpdate={(pairUid, patch) =>
                        onChange(updatePair(project, 'characters', row.uid, pairUid, patch))
                      }
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.skillUids}
                      options={skillOptions}
                      placeholder="未选技能"
                      title="勾选这个角色会的技能"
                      onChange={(next) =>
                        onChange(updateBattleList(project, 'characters', row.uid, 'skillUids', next))
                      }
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => onChange(removeBattleRow(project, 'characters', row.uid))}>
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
