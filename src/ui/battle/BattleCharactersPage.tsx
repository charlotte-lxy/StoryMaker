import type { Project } from '../../core/types';
import {
  addBattleRow,
  addCharacterWeapon,
  addPair,
  removeBattleRow,
  removeCharacterWeapon,
  removePair,
  reorderBattleRow,
  updateBattleList,
  updateBattleRow,
  updateCharacterWeapon,
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

/** 角色预设：属性数值 + 技能列表 + 武器，导出成 GAS角色，行名就是角色 ID */
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
  // 武器那一格的四份下拉：都取武器页里的表，显示名称、存 uid
  const battle = project.battle;
  const optionOf = (list: { uid: string; name: string; id?: string }[]) =>
    list.map((row) => ({
      value: row.uid,
      label: row.name.trim() === '' ? (row.id ?? '').trim() : row.name.trim(),
    }));
  const weaponOptions = optionOf(battle.weapons);
  const groupOptions = optionOf(battle.weaponGroups);
  const slotOptions = optionOf(battle.slots);
  const attackModeOptions = optionOf(battle.attackModes);
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
                <th style={{ width: 440 }}>武器</th>
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
                    {/* 武器：每把一条四下拉（武器 / 分组 / 插槽 / 攻击模式），导出成「武器ID|分组|插槽|攻击模式」 */}
                    <div className="weapon-loadout">
                      {row.weapons.map((entry) => (
                        <div className="weapon-loadout-row" key={entry.uid}>
                          <select
                            value={entry.weaponUid}
                            title="武器（下拉里显示武器名，导出写武器 ID）"
                            onChange={(event) =>
                              onChange(
                                updateCharacterWeapon(project, entry.uid, {
                                  weaponUid: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="">（未选武器）</option>
                            {weaponOptions.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                            {entry.weaponUid !== '' &&
                              !weaponOptions.some((item) => item.value === entry.weaponUid) && (
                                <option value={entry.weaponUid}>（武器已删除）</option>
                              )}
                          </select>
                          <select
                            value={entry.groupUid}
                            title="绑定分组（导出用分组表的导出名称）"
                            onChange={(event) =>
                              onChange(
                                updateCharacterWeapon(project, entry.uid, {
                                  groupUid: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="">（未选分组）</option>
                            {groupOptions.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                            {entry.groupUid !== '' &&
                              !groupOptions.some((item) => item.value === entry.groupUid) && (
                                <option value={entry.groupUid}>（分组已删除）</option>
                              )}
                          </select>
                          <select
                            value={entry.slotUid}
                            title="绑定插槽（导出用插槽表的导出名称）"
                            onChange={(event) =>
                              onChange(
                                updateCharacterWeapon(project, entry.uid, {
                                  slotUid: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="">（未选插槽）</option>
                            {slotOptions.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                            {entry.slotUid !== '' &&
                              !slotOptions.some((item) => item.value === entry.slotUid) && (
                                <option value={entry.slotUid}>（插槽已删除）</option>
                              )}
                          </select>
                          <select
                            value={entry.attackModeUid}
                            title="攻击模式（导出用攻击模式表的导出名称）"
                            onChange={(event) =>
                              onChange(
                                updateCharacterWeapon(project, entry.uid, {
                                  attackModeUid: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="">（未选攻击模式）</option>
                            {attackModeOptions.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                            {entry.attackModeUid !== '' &&
                              !attackModeOptions.some(
                                (item) => item.value === entry.attackModeUid,
                              ) && <option value={entry.attackModeUid}>（攻击模式已删除）</option>}
                          </select>
                          <button
                            type="button"
                            className="mini danger"
                            title="这个角色不带这把武器了"
                            onClick={() =>
                              onChange(removeCharacterWeapon(project, row.uid, entry.uid))
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        className="option-add name-add"
                        title="给这个角色加一把武器（分组默认火力）"
                        onClick={() => onChange(addCharacterWeapon(project, row.uid))}
                      >
                        ＋ 添加武器
                      </button>
                    </div>
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
