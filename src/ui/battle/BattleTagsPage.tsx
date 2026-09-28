import { Fragment } from 'react';

import { classPath, collectGameplayTags } from '../../core/battle';
import type { Project } from '../../core/types';
import { updateBattleRow, updateClassPrefix, type BattleRowKey } from '../../state/battle-operations';

interface Props {
  project: Project;
  onChange: (next: Project) => void;
}

/** 收集出来的 Tag 来自哪张表：改备注时要写回对应的表 */
const GROUP_KEY: Record<string, BattleRowKey> = {
  属性: 'attributes',
  效果: 'effects',
  技能: 'skills',
  事件: 'events',
};

/**
 * GameplayTags 管理器。
 *
 * 属性 / 效果 / 技能 / 事件四张表里的条目自动收集过来，每个模块一张表纵向排列，
 * 显示名字、合成后的 Tag 与一栏可以编辑的备注（导出成 DevComment）。
 * Tag 不用手填，改名之后这里立刻跟着变。
 *
 * 顺带把类名路径前缀放在这一页：它和 Tag 一样是导出时自动补全的东西，
 * 换项目只改这里，不用改代码。
 */
export function BattleTagsPage({ project, onChange }: Props) {
  const entries = collectGameplayTags(project.battle);
  const groups = ['属性', '效果', '技能', '事件'];

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>GameplayTags 管理器</h2>
        <span className="hint">
          四张表里的条目都会收集到这里，Tag 由名字合成（GAS.属性.xxx / GAS.效果.xxx / GAS.技能.xxx /
          GAS.事件.xxx），导出成 GASGameplayTags 子表。
        </span>
      </div>

      <div className="battle-prefix-card">
        <label className="battle-prefix-field">
          <span className="line-field-name">技能类名路径前缀</span>
          <input
            value={project.battle.skillClassPrefix}
            onChange={(event) => onChange(updateClassPrefix(project, 'skillClassPrefix', event.target.value))}
          />
          <span className="hint">
            类名 BP_GA_Heal → {classPath(project.battle.skillClassPrefix, 'BP_GA_Heal') || '（前缀为空）'}
          </span>
        </label>

        <label className="battle-prefix-field">
          <span className="line-field-name">效果类名路径前缀</span>
          <input
            value={project.battle.effectClassPrefix}
            onChange={(event) => onChange(updateClassPrefix(project, 'effectClassPrefix', event.target.value))}
          />
          <span className="hint">
            类名 BP_GameEffect_Base →{' '}
            {classPath(project.battle.effectClassPrefix, 'BP_GameEffect_Base') || '（前缀为空）'}
          </span>
        </label>
      </div>

      {groups.map((group) => {
        const rows = entries.filter((entry) => entry.group === group);
        const tableKey = GROUP_KEY[group];
        return (
          <Fragment key={group}>
            <h3 className="section-head">
              {group}
              <span>{rows.length} 条</span>
            </h3>

            {rows.length === 0 ? (
              <div className="empty-state">「{group}」表里还没有条目。</div>
            ) : (
              <table className="lines">
                <thead>
                  <tr>
                    <th style={{ width: '26%' }}>名称</th>
                    <th style={{ width: '37%' }}>合成后的 GameplayTag</th>
                    <th>备注（导出成 DevComment）</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr className="line-row" key={entry.uid} data-battle-uid={entry.uid}>
                      <td>{entry.name}</td>
                      <td className="cell-id">{entry.tag}</td>
                      <td>
                        <input
                          value={entry.tagNote}
                          placeholder="给自己看的备注"
                          onChange={(event) =>
                            onChange(
                              updateBattleRow(project, tableKey, entry.uid, {
                                tagNote: event.target.value,
                              }),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
