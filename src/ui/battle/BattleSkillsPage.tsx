import { classPath } from '../../core/battle';
import type { Project } from '../../core/types';
import {
  addBattleRow,
  addPair,
  removeBattleRow,
  removePair,
  updateBattleList,
  updateBattleRow,
  updateClassPrefix,
  updatePair,
} from '../../state/battle-operations';
import { MultiSelect } from '../MultiSelect';
import { PairList } from './PairList';
import { useScrollMemory } from '../view-memory';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/** 技能表（GA） */
export function BattleSkillsPage({ project, onChange }: Props) {
  const editorRef = useScrollMemory('battle:skills');
  const rows = project.battle.skills;
  const skillNames = project.battle.skills.map((row) => row.name.trim()).filter(Boolean);
  const eventNames = project.battle.events.map((row) => row.name.trim()).filter(Boolean);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>技能表（GA）</h2>
        <span className="hint">
          技能名合成 Tag「GAS.技能.技能名」；锁定 GA 与监听事件都是从对应表里多选，参数赋值按「参数名 = 值」填。
        </span>
        <button type="button" className="primary" onClick={() => onChange(addBattleRow(project, 'skills'))}>
          ＋ 新增技能
        </button>
      </div>

      <div className="battle-prefix-card">
        <label className="battle-prefix-field">
          <span className="line-field-name">类名路径前缀</span>
          <input
            value={project.battle.skillClassPrefix}
            onChange={(event) => onChange(updateClassPrefix(project, 'skillClassPrefix', event.target.value))}
          />
          <span className="hint">GA类 = {classPath(project.battle.skillClassPrefix, 'BP_GA_Heal') || '（前缀为空）'}</span>
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">还没有技能。点右上角「＋ 新增技能」。</div>
      ) : (
        <div className="battle-table-wrap">
          <table className="lines battle-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>技能名</th>
                <th style={{ width: 170 }}>类名</th>
                <th style={{ width: 190 }}>锁定GA列表</th>
                <th style={{ width: 190 }}>监听事件列表</th>
                <th style={{ width: 260 }}>参数赋值列表</th>
                <th style={{ width: 74 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="line-row" key={row.uid} data-battle-uid={row.uid}>
                  <td>
                    <input
                      value={row.name}
                      placeholder="技能名"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'skills', row.uid, { name: event.target.value }))
                      }
                    />
                    {(counts.get(row.name.trim()) ?? 0) > 1 && <div className="field-error">技能名重复</div>}
                  </td>
                  <td>
                    <input
                      value={row.className}
                      placeholder="BP_GA_xxx"
                      title="蓝图类名，导出时补成 GA类 全路径"
                      onChange={(event) =>
                        onChange(updateBattleRow(project, 'skills', row.uid, { className: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.lockSkills}
                      options={skillNames}
                      placeholder="未锁定"
                      title="勾选这个技能要锁定的其他技能"
                      onChange={(next) => onChange(updateBattleList(project, 'skills', row.uid, 'lockSkills', next))}
                    />
                  </td>
                  <td>
                    <MultiSelect
                      values={row.listenEvents}
                      options={eventNames}
                      placeholder="未监听"
                      title="勾选这个技能要监听的事件"
                      onChange={(next) =>
                        onChange(updateBattleList(project, 'skills', row.uid, 'listenEvents', next))
                      }
                    />
                  </td>
                  <td>
                    <PairList
                      pairs={row.parameters}
                      keyPlaceholder="参数名"
                      valuePlaceholder="值"
                      addLabel="＋ 添加参数"
                      onAdd={() => onChange(addPair(project, 'skills', row.uid))}
                      onRemove={(pairUid) => onChange(removePair(project, 'skills', row.uid, pairUid))}
                      onUpdate={(pairUid, patch) =>
                        onChange(updatePair(project, 'skills', row.uid, pairUid, patch))
                      }
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => onChange(removeBattleRow(project, 'skills', row.uid))}>
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
