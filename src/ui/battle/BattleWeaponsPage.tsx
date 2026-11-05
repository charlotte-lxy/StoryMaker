import type { GasOptionRow, Project } from '../../core/types';
import {
  addBattleRow,
  addWeaponOption,
  removeBattleRow,
  removeWeaponOption,
  reorderBattleRow,
  updateBattleList,
  updateBattleRow,
  updateWeaponOption,
  type WeaponOptionKey,
} from '../../state/battle-operations';
import { MultiSelect } from '../MultiSelect';
import { OrderCell, useRowDrag } from './row-drag';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/**
 * 武器页。
 *
 * 顶上两张配置小表：攻击模式 / 插槽（都带「显示名称 + 导出名称」，各条用 uid 绑定，
 * 改名字只会改显示，导出跟着导出名称走）。下面才是武器表：
 * 弹匣容量 / 攻击速度 / 能量消耗都是手填数值，支持攻击模式与支持插槽是多选。
 */
export function BattleWeaponsPage({ project, onChange }: Props) {
  const editorRef = useScrollMemory('battle:weapons');
  const rows = project.battle.weapons;
  const optionOf = (list: GasOptionRow[]) =>
    list.map((row) => ({ value: row.uid, label: row.name.trim() })).filter((item) => item.label !== '');
  const attackModeOptions = optionOf(project.battle.attackModes);
  const slotOptions = optionOf(project.battle.slots);
  const drag = useRowDrag((from, to) => onChange(reorderBattleRow(project, 'weapons', from, to)));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row.id.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const optionTable = (key: WeaponOptionKey, title: string, hint: string) => {
    const list = project.battle[key];
    return (
      <section className="config-panel">
        <div className="lookup-subhead">
          <h3>{title}</h3>
          <span className="hint">{hint}</span>
          <button
            type="button"
            className="primary"
            onClick={() => onChange(addWeaponOption(project, key))}
          >
            ＋ 新增{key === 'attackModes' ? '攻击模式' : '插槽'}
          </button>
        </div>

        {list.length === 0 ? (
          <div className="empty-state">
            还没有{key === 'attackModes' ? '攻击模式' : '插槽'}。先加一条，武器表里就能勾选它。
          </div>
        ) : (
          <table className="lines">
            <thead>
              <tr>
                <th>显示名称</th>
                <th>导出名称</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr className="line-row" key={row.uid}>
                  <td>
                    <input
                      value={row.name}
                      placeholder="界面下拉里显示的名字"
                      onChange={(event) =>
                        onChange(updateWeaponOption(project, key, row.uid, { name: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.exportName}
                      placeholder={key === 'attackModes' ? 'TXT_AttackMode_…' : '导出表里写的名字'}
                      title="导出表里写这一串；留空的话这一条不会导出"
                      onChange={(event) =>
                        onChange(
                          updateWeaponOption(project, key, row.uid, { exportName: event.target.value }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mini danger"
                      title="删掉这一条；武器里勾过它的也会一起去掉"
                      onClick={() => onChange(removeWeaponOption(project, key, row.uid))}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  return (
    <div className="editor" ref={editorRef}>
      <div className="char-config">
        {optionTable(
          'attackModes',
          '攻击模式',
          '武器能用的攻击方式；显示名称给下拉用，导出名称写进「支持攻击模式列表」',
        )}
        {optionTable('slots', '插槽', '武器支持的插槽；显示名称给下拉用，导出名称写进「支持插槽列表」')}
      </div>

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
                <th style={{ width: 84 }}>能量消耗</th>
                <th style={{ width: 200 }}>支持攻击模式</th>
                <th style={{ width: 180 }}>支持插槽</th>
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
                    <input
                      value={row.energyCost}
                      placeholder="0"
                      title="开一枪要消耗多少能量"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'weapons', row.uid, { energyCost: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.attackModeUids}
                      options={attackModeOptions}
                      placeholder="未选攻击模式"
                      title="勾选这把武器支持的攻击模式（显示名称，导出用导出名称）"
                      onChange={(next) =>
                        onChange(updateBattleList(project, 'weapons', row.uid, 'attackModeUids', next))
                      }
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.slotUids}
                      options={slotOptions}
                      placeholder="未选插槽"
                      title="勾选这把武器支持的插槽（显示名称，导出用导出名称）"
                      onChange={(next) =>
                        onChange(updateBattleList(project, 'weapons', row.uid, 'slotUids', next))
                      }
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
