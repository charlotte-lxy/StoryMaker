import { Fragment, useEffect, useMemo, useState } from 'react';

import { useScrollMemory } from './view-memory';

import { commandDefLabel, matchCommandDef } from '../core/command-build';
import type { CommandDef, Project, TargetKind, ValueKind } from '../core/types';
import { collectCommands, parseCommand } from '../state/operations';

interface Props {
  project: Project;
  onJumpToLine: (lineUid: string) => void;
  onRenameCommand: (from: string, to: string) => void;
  onAddDef: (category: '条件' | '指令') => void;
  onRemoveDef: (uid: string) => void;
  onUpdateDef: (uid: string, patch: Partial<CommandDef>) => void;
  /** 全局搜索跳过来的字典行：交给上层滚过去，这里只负责切页与高亮 */
  focusUid?: string | null;
}

const TARGET_OPTIONS: { value: TargetKind; label: string }[] = [
  { value: 'character', label: '角色表' },
  { value: 'item', label: '物品表' },
  { value: 'quest', label: '任务表' },
  { value: 'image', label: '立绘表' },
  { value: 'sound', label: '音效表' },
  { value: 'line', label: '对话表' },
  { value: 'manual', label: '手工填写' },
  { value: 'none', label: '无目标' },
];

const VALUE_OPTIONS: { value: ValueKind; label: string }[] = [
  { value: 'expression', label: '该角色的表情' },
  { value: 'action', label: '该角色的动作' },
  { value: 'number', label: '手填数字' },
  { value: 'fixed', label: '固定选项' },
  { value: 'none', label: '无结果' },
];

const SECTIONS = ['条件', '指令'] as const;

/**
 * 条件与指令模块。
 *
 * 「条件」用在选项的出现/可用条件上，「指令」用在对话行的指令栏和选项的结果上。
 * 两者格式一样，但用途不同，因此在这个模块里分区展示。
 */
export function CommandEditor({
  project,
  onJumpToLine,
  onRenameCommand,
  onAddDef,
  onRemoveDef,
  onUpdateDef,
  focusUid = null,
}: Props) {
  const editorRef = useScrollMemory('command');
  const [tab, setTab] = useState<'dict' | 'usage'>('dict');
  const commands = useMemo(() => collectCommands(project), [project]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // 全局搜索跳过来的字典行：先切回「字典」这一页，不然那一行根本不在跟前
  useEffect(() => {
    if (focusUid === null) return;
    setTab('dict');
  }, [focusUid]);

  // 切回字典页之后再把那一行滚到眼前。上层统一的那次滚动是在同一轮里跑的，
  // 当时字典表还没渲染出来（页面停在「使用情况」上），会落空
  useEffect(() => {
    if (focusUid === null || tab !== 'dict') return;
    document.querySelector(`[data-search-uid="${focusUid}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusUid, tab]);

  /** 每条实际用到的指令属于条件还是指令 */
  const usageByCategory = useMemo(() => {
    const grouped: Record<string, typeof commands> = { 条件: [], 指令: [], 未定义: [] };
    for (const item of commands) {
      const parsed = item.parsed;
      const def = parsed === null ? undefined : matchCommandDef(parsed, project.commands);
      grouped[def?.category ?? '未定义'].push(item);
    }
    return grouped;
  }, [commands, project.commands]);

  const commitRename = (from: string): void => {
    const next = draft.trim();
    if (next !== '' && next !== from) onRenameCommand(from, next);
    setEditingText(null);
  };

  const renderDefTable = (category: '条件' | '指令') => {
    const defs = project.commands.filter((def) => def.category === category);
    return (
      <table className="lines">
        <thead>
          <tr>
            <th className="col-mid">主指令</th>
            <th className="col-mid">分支</th>
            <th className="col-mid">目标来源</th>
            <th className="col-narrow">属性</th>
            <th className="col-narrow">运算符</th>
            <th className="col-mid">结果来源</th>
            <th>说明 / 固定值</th>
            <th className="col-narrow">操作</th>
          </tr>
        </thead>
        <tbody>
          {defs.map((def) => (
            <tr
              className={`line-row${focusUid === def.uid ? ' flash' : ''}`}
              key={def.uid}
              data-search-uid={def.uid}
            >
              <td>
                <input
                  value={def.head}
                  onChange={(event) => onUpdateDef(def.uid, { head: event.target.value })}
                />
              </td>
              <td>
                <input
                  value={def.branch}
                  placeholder="（无分支）"
                  onChange={(event) => onUpdateDef(def.uid, { branch: event.target.value })}
                />
              </td>
              <td>
                <select
                  value={def.target}
                  onChange={(event) =>
                    onUpdateDef(def.uid, { target: event.target.value as TargetKind })
                  }
                >
                  {TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={def.attribute}
                  placeholder="（无）"
                  onChange={(event) => onUpdateDef(def.uid, { attribute: event.target.value })}
                />
              </td>
              <td>
                <input
                  value={def.operator}
                  placeholder="（无）"
                  onChange={(event) => onUpdateDef(def.uid, { operator: event.target.value })}
                />
              </td>
              <td>
                <select
                  value={def.value}
                  onChange={(event) =>
                    onUpdateDef(def.uid, { value: event.target.value as ValueKind })
                  }
                >
                  {VALUE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={def.note}
                  placeholder="给策划看的说明"
                  onChange={(event) => onUpdateDef(def.uid, { note: event.target.value })}
                />
                {def.value === 'fixed' && (
                  <input
                    className="fixed-values"
                    value={def.fixedValues.join(',')}
                    placeholder="固定候选值，逗号分隔，如 1,0"
                    onChange={(event) =>
                      onUpdateDef(def.uid, {
                        fixedValues: event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter((item) => item !== ''),
                      })
                    }
                  />
                )}
              </td>
              <td>
                <button type="button" onClick={() => onRemoveDef(def.uid)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="editor" ref={editorRef}>
      <div className="editor-head">
        <h2>条件与指令</h2>
        <div className="tab-row">
          <button
            type="button"
            className={tab === 'dict' ? 'tab active' : 'tab'}
            onClick={() => setTab('dict')}
          >
            字典（{project.commands.length}）
          </button>
          <button
            type="button"
            className={tab === 'usage' ? 'tab active' : 'tab'}
            onClick={() => setTab('usage')}
          >
            使用情况（{commands.length}）
          </button>
        </div>
        {tab === 'dict' && (
          <div className="tab-row">
            {SECTIONS.map((category) => (
              <button key={category} type="button" onClick={() => onAddDef(category)}>
                ＋ {category}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'dict' ? (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>条件</strong>用在选项的「出现条件」「可用条件」上；
            <strong>指令</strong>用在对话行的指令栏和选项的「结果」上。这里定义后，填写时就能全用下拉选。
          </p>
          {SECTIONS.map((category) => (
            <Fragment key={category}>
              <h3 className="section-head">
                {category}
                <span>{project.commands.filter((def) => def.category === category).length} 条</span>
              </h3>
              {renderDefTable(category)}
            </Fragment>
          ))}
        </>
      ) : commands.length === 0 ? (
        <div className="empty-state">
          还没有用到任何条件或指令。在「剧情」模块的指令栏、或选项的条件栏里填写后会汇总到这里。
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            共 {commands.length} 种，点指令原文可以改名，所有使用处一起更新。
          </p>
          {(['条件', '指令', '未定义'] as const).map((category) => {
            const items = usageByCategory[category];
            if (items.length === 0) return null;
            return (
              <Fragment key={category}>
                <h3 className="section-head">
                  {category === '未定义' ? '未在字典中定义' : category}
                  <span>{items.length} 条</span>
                </h3>
                <table className="lines">
                  <thead>
                    <tr>
                      <th>原文</th>
                      <th className="col-mid">主指令.分支</th>
                      <th className="col-mid">目标对象</th>
                      <th className="col-narrow">属性</th>
                      <th className="col-mid">运算符/结果</th>
                      <th className="col-narrow">使用</th>
                      <th className="col-mid">出现位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const parsed = item.parsed;
                      return (
                        <tr className="line-row" key={item.text}>
                          <td>
                            {editingText === item.text ? (
                              <input
                                autoFocus
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={() => commitRename(item.text)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') commitRename(item.text);
                                  if (event.key === 'Escape') setEditingText(null);
                                }}
                              />
                            ) : (
                              <span
                                className="command-text"
                                title="点击可改名，所有使用处会一起更新"
                                onClick={() => {
                                  setEditingText(item.text);
                                  setDraft(item.text);
                                }}
                              >
                                {item.text}
                              </span>
                            )}
                          </td>
                          <td className="command-cell">
                            {parsed === null ? (
                              <span className="warn-text">无法解析</span>
                            ) : (
                              `${parsed.name}.${parsed.branch}`
                            )}
                          </td>
                          <td className="command-cell">{parsed?.target ?? '—'}</td>
                          <td className="command-cell">{parsed?.attribute ?? ''}</td>
                          <td className="command-cell">
                            {parsed === null || parsed.operator === ''
                              ? ''
                              : `${parsed.operator}${parsed.value}`}
                          </td>
                          <td className="command-cell">{item.count} 次</td>
                          <td>
                            <div className="command-locations">
                              {item.locations.map((loc) => (
                                <button
                                  type="button"
                                  key={`${loc.lineUid}-${loc.lineId}`}
                                  className="loc-chip"
                                  title={`跳到 ${loc.groupLabel}`}
                                  onClick={() => onJumpToLine(loc.lineUid)}
                                >
                                  {loc.lineId}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Fragment>
            );
          })}
        </>
      )}

      <div className="command-note">
        <strong>格式说明</strong>
        <code>主指令.分支# 目标对象.目标属性 运算符 目标结果</code>
        <span>
          方括号部分可省略，例如 <code>特殊# SP_001</code> 只有前两段。字典里把每一段的来源指定好，写剧情时就能全部用下拉选，不必手打。
        </span>
      </div>
    </div>
  );
}

export { commandDefLabel, parseCommand };
