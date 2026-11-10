import type { Project } from '../../core/types';
import {
  addBattleRow,
  addCharacterWeapon,
  addWeaponGroupBinding,
  addPair,
  removeBattleRow,
  removeCharacterWeapon,
  removeWeaponGroupBinding,
  removePair,
  reorderBattleRow,
  updateBattleList,
  mountWeaponSlot,
  setCharacterWeapon,
  setWeaponGroupBindingGroup,
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
  const attackModeOptions = optionOf(battle.attackModes);
  /** 绑定关系里按插槽表铺开：每个插槽一格 */
  const slotColumns = battle.slots.map((row) => ({
    uid: row.uid,
    label: row.name.trim() === '' ? '（未命名插槽）' : row.name.trim(),
  }));

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
                <th style={{ width: 260 }}>武器</th>
                <th style={{ width: 560 }}>绑定关系</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                // 武器列里已经选好武器的那些条：编号从 1 开始，绑定关系的下拉按它列
                const filledWeapons = row.weapons
                  .filter((entry) => entry.weaponUid !== '')
                  .map((entry) => {
                    const weapon = battle.weapons.find((item) => item.uid === entry.weaponUid);
                    const label =
                      weapon === undefined
                        ? '（武器已删除）'
                        : weapon.name.trim() === ''
                          ? weapon.id.trim()
                          : weapon.name.trim();
                    return { entry, weapon, label };
                  })
                  .filter(
                    (item): item is { entry: (typeof row.weapons)[number]; weapon: NonNullable<typeof item.weapon>; label: string } =>
                      item.weapon !== undefined,
                  )
                  .map((item, position) => ({ ...item, index: position + 1 }));

                // 绑定关系下拉里能选的武器：武器列里的这些条（序号 - 武器名）
                const freeGroupCount =
                  battle.weaponGroups.length -
                  row.weaponBindings.filter((item) => item.groupUid !== '').length;
                const attackModesOf = (weapon: (typeof battle.weapons)[number] | undefined) =>
                  weapon === undefined
                    ? []
                    : weapon.attackModeUids
                        .map((uid) => attackModeOptions.find((item) => item.value === uid))
                        .filter((item) => item !== undefined);

                return (
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
                    {/* 武器列：只挑武器，按顺序编号（导出就是这个顺序的下标） */}
                    <div className="weapon-list">
                      {row.weapons.map((entry) => {
                        const no = filledWeapons.find((item) => item.entry.uid === entry.uid)?.index;
                        return (
                          <div className="weapon-item" key={entry.uid}>
                            <span className="weapon-index" title="武器编号：绑定关系里的下标就是它">
                              {no === undefined ? '—' : no}
                            </span>
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
                              title="不要这把武器了（绑定关系里装着它的插槽一起清掉）"
                              onClick={() =>
                                onChange(removeCharacterWeapon(project, row.uid, entry.uid))
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        className="option-add name-add"
                        title="给这个角色加一条武器"
                        onClick={() => onChange(addCharacterWeapon(project, row.uid))}
                      >
                        ＋ 添加武器
                      </button>
                    </div>
                  </td>
                  <td>
                    {/* 绑定关系列：每个分组一行，行里每个插槽一个下拉，装好武器后选攻击模式 */}
                    <div className="weapon-bindings">
                      {row.weaponBindings.map((binding) => {
                        const usedGroups = row.weaponBindings
                          .filter((item) => item.uid !== binding.uid)
                          .map((item) => item.groupUid);
                        const groupName =
                          groupOptions.find((item) => item.value === binding.groupUid)?.label ??
                          '（未选分组）';

                        return (
                          <div className="binding-group" key={binding.uid}>
                            <div className="binding-group-head">
                              <select
                                value={binding.groupUid}
                                title="这个绑定关系属于哪个分组（同一角色里不重复）"
                                onChange={(event) =>
                                  onChange(
                                    setWeaponGroupBindingGroup(project, binding.uid, event.target.value),
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
                              <button
                                type="button"
                                className="mini danger"
                                title="删掉这个分组的所有绑定"
                                onClick={() => onChange(removeWeaponGroupBinding(project, binding.uid))}
                              >
                                ×
                              </button>
                            </div>

                            <div className="binding-slots">
                              {slotColumns.map((slot) => {
                                const mount = binding.mounts.find(
                                  (item) => item.slotUid === slot.uid,
                                );
                                const mounted = filledWeapons.find(
                                  (item) => item.entry.uid === mount?.weaponEntryUid,
                                );
                                const modes = mounted === undefined ? [] : attackModesOf(mounted.weapon);
                                return (
                                  <div className="binding-slot" key={slot.uid}>
                                    <span className="binding-slot-name" title="插槽">
                                      {slot.label}
                                    </span>
                                    <select
                                      value={mount?.weaponEntryUid ?? ''}
                                      title={`${groupName} · ${slot.label}：装哪条武器`}
                                      onChange={(event) =>
                                        onChange(
                                          mountWeaponSlot(project, binding.uid, slot.uid, {
                                            weaponEntryUid: event.target.value,
                                          }),
                                        )
                                      }
                                    >
                                      <option value="">（空）</option>
                                      {filledWeapons.map((item) => {
                                        const usedHere = binding.mounts.some(
                                          (other) =>
                                            other.weaponEntryUid === item.entry.uid &&
                                            other.slotUid !== slot.uid,
                                        );
                                        const supported = item.weapon.slotUids.includes(slot.uid);
                                        return (
                                          <option
                                            key={item.entry.uid}
                                            value={item.entry.uid}
                                            disabled={usedHere || !supported}
                                            title={
                                              usedHere
                                                ? '这条武器已经在这个分组里了'
                                                : supported
                                                  ? ''
                                                  : '这条武器不支持这个插槽'
                                            }
                                          >
                                            {item.index} - {item.label}
                                            {usedHere ? '（本组已用）' : ''}
                                            {!supported && !usedHere ? '（不支持此插槽）' : ''}
                                          </option>
                                        );
                                      })}
                                      {mount !== undefined && mounted === undefined && (
                                        <option value={mount.weaponEntryUid}>（武器已删除）</option>
                                      )}
                                    </select>
                                    {mounted !== undefined && modes.length > 0 && (
                                      <span className="attack-modes">
                                        {modes.map((mode) => (
                                          <label key={mode.value} title="攻击模式">
                                            <input
                                              type="radio"
                                              name={`mode-${binding.uid}-${slot.uid}`}
                                              checked={mount?.attackModeUid === mode.value}
                                              onChange={() =>
                                                onChange(
                                                  mountWeaponSlot(project, binding.uid, slot.uid, {
                                                    attackModeUid: mode.value,
                                                  }),
                                                )
                                              }
                                            />
                                            {mode.label}
                                          </label>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        className="option-add name-add"
                        disabled={freeGroupCount === 0}
                        title={freeGroupCount === 0 ? '分组都用完了' : '再加一个分组'}
                        onClick={() => onChange(addWeaponGroupBinding(project, row.uid))}
                      >
                        ＋ 添加分组
                      </button>
                    </div>
                  </td>
                  <td>
                    <button type="button" onClick={() => onChange(removeBattleRow(project, 'characters', row.uid))}>
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
    </div>
  );
}
