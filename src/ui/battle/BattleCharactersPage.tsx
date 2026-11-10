import type { Project } from '../../core/types';
import {
  addBattleRow,
  addCharacterWeapon,
  addWeaponBinding,
  addPair,
  removeBattleRow,
  removeCharacterWeapon,
  removeWeaponBinding,
  removePair,
  reorderBattleRow,
  updateBattleList,
  setCharacterWeapon,
  updateBattleRow,
  updateWeaponBinding,
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

  /**
   * 只列这把武器支持的插槽 / 攻击模式（顺序按武器表里勾选的顺序）。
   *
   * 武器表里没勾的就不出现在下拉里——避免配出「武器不支持这个插槽」的组合。
   * 没选武器时是空清单，下拉会置灰。
   */
  const supportedOf = (uids: readonly string[], all: { value: string; label: string }[]) =>
    uids.map((uid) => all.find((item) => item.value === uid)).filter((item) => item !== undefined);

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
                    {/* 武器：先挑武器，再给它挂若干绑定关系（分组 / 插槽 / 攻击模式），导出成「武器ID=分组,插槽,攻击模式|…」 */}
                    <div className="weapon-loadout">
                      {row.weapons.map((entry) => {
                        const weapon = battle.weapons.find((item) => item.uid === entry.weaponUid);
                        const entrySlots = supportedOf(weapon?.slotUids ?? [], slotOptions);
                        const entryModes = supportedOf(
                          weapon?.attackModeUids ?? [],
                          attackModeOptions,
                        );
                        const noWeapon = weapon === undefined;
                        // 同一把武器（这个角色里的所有同名武器条目）分组不能重复
                        const usedGroups = row.weapons
                          .filter((item) => item.weaponUid === entry.weaponUid)
                          .flatMap((item) => item.bindings.map((binding) => binding.groupUid));
                        const freeGroups = groupOptions.filter(
                          (item) => !usedGroups.includes(item.value),
                        );
                        const slotHint = noWeapon
                          ? '先选武器，这里只列这把武器支持的插槽'
                          : '这把武器在武器表里没勾选任何插槽，先去武器表勾选';
                        const modeHint = noWeapon
                          ? '先选武器，这里只列这把武器支持的攻击模式'
                          : '这把武器在武器表里没勾选任何攻击模式，先去武器表勾选';

                        return (
                          <div className="weapon-entry" key={entry.uid}>
                            <div className="weapon-entry-head">
                              <select
                                value={entry.weaponUid}
                                title="武器（下拉里显示武器名，导出写武器 ID）"
                                onChange={(event) =>
                                  onChange(setCharacterWeapon(project, entry.uid, event.target.value))
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
                              <button
                                type="button"
                                className="mini danger"
                                title="这个角色不带这把武器了（它的绑定关系一起删掉）"
                                onClick={() =>
                                  onChange(removeCharacterWeapon(project, row.uid, entry.uid))
                                }
                              >
                                ×
                              </button>
                            </div>

                            {entry.bindings.map((binding) => (
                              <div className="weapon-binding" key={binding.uid}>
                                <select
                                  value={binding.groupUid}
                                  disabled={noWeapon}
                                  title={
                                    noWeapon
                                      ? '先选武器，再选分组'
                                      : usedGroups.filter((uid) => uid !== binding.groupUid).length >=
                                          groupOptions.length
                                        ? '分组表里还没有可用的分组'
                                        : '绑定分组（同一把武器里不能重复；导出用分组表的导出名称）'
                                  }
                                  onChange={(event) =>
                                    onChange(
                                      updateWeaponBinding(project, binding.uid, {
                                        groupUid: event.target.value,
                                      }),
                                    )
                                  }
                                >
                                  <option value="">（未选分组）</option>
                                  {groupOptions
                                    .filter(
                                      (item) =>
                                        item.value === binding.groupUid ||
                                        !usedGroups.includes(item.value),
                                    )
                                    .map((item) => (
                                      <option key={item.value} value={item.value}>
                                        {item.label}
                                      </option>
                                    ))}
                                  {binding.groupUid !== '' &&
                                    !groupOptions.some((item) => item.value === binding.groupUid) && (
                                      <option value={binding.groupUid}>（分组已删除）</option>
                                    )}
                                </select>
                                <select
                                  value={binding.slotUid}
                                  disabled={noWeapon || entrySlots.length === 0}
                                  title={
                                    entrySlots.length === 0
                                      ? slotHint
                                      : '绑定插槽（只列这把武器支持的；导出用插槽表的导出名称）'
                                  }
                                  onChange={(event) =>
                                    onChange(
                                      updateWeaponBinding(project, binding.uid, {
                                        slotUid: event.target.value,
                                      }),
                                    )
                                  }
                                >
                                  <option value="">（未选插槽）</option>
                                  {entrySlots.map((item) => (
                                    <option key={item.value} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                  {binding.slotUid !== '' &&
                                    !entrySlots.some((item) => item.value === binding.slotUid) && (
                                      <option value={binding.slotUid}>
                                        {slotOptions.find((item) => item.value === binding.slotUid)
                                          ?.label ?? '（插槽已删除）'}
                                        （这把武器不支持）
                                      </option>
                                    )}
                                </select>
                                <select
                                  value={binding.attackModeUid}
                                  disabled={noWeapon || entryModes.length === 0}
                                  title={
                                    entryModes.length === 0
                                      ? modeHint
                                      : '攻击模式（只列这把武器支持的；导出用攻击模式表的导出名称）'
                                  }
                                  onChange={(event) =>
                                    onChange(
                                      updateWeaponBinding(project, binding.uid, {
                                        attackModeUid: event.target.value,
                                      }),
                                    )
                                  }
                                >
                                  <option value="">（未选攻击模式）</option>
                                  {entryModes.map((item) => (
                                    <option key={item.value} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                  {binding.attackModeUid !== '' &&
                                    !entryModes.some(
                                      (item) => item.value === binding.attackModeUid,
                                    ) && (
                                      <option value={binding.attackModeUid}>
                                        {attackModeOptions.find(
                                          (item) => item.value === binding.attackModeUid,
                                        )?.label ?? '（攻击模式已删除）'}
                                        （这把武器不支持）
                                      </option>
                                    )}
                                </select>
                                <button
                                  type="button"
                                  className="mini danger"
                                  title="删掉这条绑定关系"
                                  onClick={() =>
                                    onChange(removeWeaponBinding(project, entry.uid, binding.uid))
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            ))}

                            <button
                              type="button"
                              className="option-add name-add"
                              disabled={noWeapon || freeGroups.length === 0}
                              title={
                                noWeapon
                                  ? '先在上面选武器'
                                  : freeGroups.length === 0
                                    ? '这把武器的分组都绑完了'
                                    : '再给这把武器加一条绑定关系（分组挑一个还没用的）'
                              }
                              onClick={() => onChange(addWeaponBinding(project, entry.uid))}
                            >
                              ＋ 添加绑定
                            </button>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        className="option-add name-add"
                        title="给这个角色加一把武器，选好武器后再加绑定关系"
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
