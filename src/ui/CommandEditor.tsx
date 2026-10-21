import { useEffect, useState } from 'react';

import { useScrollMemory } from './view-memory';

import { collectCommands } from '../state/operations';
import { parseCommandText } from '../core/command-build';
import type { CommandDef, CommandParamDef, ParamSource, Project } from '../core/types';

interface Props {
  project: Project;
  onJumpToLine: (lineUid: string) => void;
  onAddDef: (category: '条件' | '指令') => void;
  onRemoveDef: (uid: string) => void;
  onUpdateDef: (uid: string, patch: Partial<CommandDef>) => void;
  onAddParam: (defUid: string) => void;
  onRemoveParam: (defUid: string, paramUid: string) => void;
  onUpdateParam: (defUid: string, paramUid: string, patch: Partial<CommandParamDef>) => void;
  onMoveParam: (defUid: string, paramUid: string, delta: number) => void;
  /** 全局搜索 / 校验条跳过来的字典行：切到那一类，滚过去并闪一下 */
  focusUid?: string | null;
}

/** 参数的值来源，顺序按「先表格、再特殊、再手填」排 */
const SOURCE_OPTIONS: { value: ParamSource; label: string }[] = [
  { value: 'character', label: '角色表' },
  { value: 'item', label: '物品表' },
  { value: 'quest', label: '任务表' },
  { value: 'image', label: '立绘表' },
  { value: 'sound', label: '音效表' },
  { value: 'line', label: '对话表' },
  { value: 'expression', label: '该角色表情' },
  { value: 'action', label: '该角色动作' },
  { value: 'number', label: '手填数字' },
  { value: 'text', label: '手填文本' },
  { value: 'fixed', label: '固定选项' },
];

const SECTIONS = ['条件', '指令'] as const;
type Section = (typeof SECTIONS)[number];

/** 选项集输入框里的文字 → 候选值数组：中英文逗号都认，去掉空项 */
function splitOptions(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * 条件与指令模块。
 *
 * 左边一栏分「条件 / 指令」两页：条件用在选项的出现/可用条件上，指令用在对话行的指令栏上。
 * 每页两个页签：字典（这条指令有哪些参数）与使用情况（剧情里哪些地方用了它）。
 */
export function CommandEditor({
  project,
  onJumpToLine,
  onAddDef,
  onRemoveDef,
  onUpdateDef,
  onAddParam,
  onRemoveParam,
  onUpdateParam,
  onMoveParam,
  focusUid = null,
}: Props) {
  const editorRef = useScrollMemory('command');
  const [section, setSection] = useState<Section>('指令');
  const [tab, setTab] = useState<'dict' | 'usage'>('dict');
  /** 展开着参数表的定义 uid */
  const [expanded, setExpanded] = useState<string | null>(null);

  // 跳过来的那一行：先切到它所在的类别与「字典」页，再展开参数
  useEffect(() => {
    if (focusUid === null) return;
    const def = project.commands.find((item) => item.uid === focusUid);
    if (def === undefined) return;
    setSection(def.category);
    setTab('dict');
    setExpanded(def.uid);
  }, [focusUid, project.commands]);

  useEffect(() => {
    if (focusUid === null || tab !== 'dict') return;
    document.querySelector(`[data-search-uid="${focusUid}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusUid, tab, section]);

  const defs = project.commands.filter((def) => def.category === section);
  const usage = collectCommands(project, section);

  const renderParams = (def: CommandDef) => (
    <div className="command-params">
      <table className="lines param-table">
        <thead>
          <tr>
            <th style={{ width: 120 }}>参数名</th>
            <th style={{ width: 130 }}>值来源</th>
            <th style={{ width: 150 }}>选项集</th>
            <th style={{ width: 90 }}>参数类型</th>
            <th>参数说明</th>
            <th style={{ width: 130 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {def.params.map((param, index) => (
            <tr className="line-row" key={param.uid}>
              <td>
                <input
                  value={param.name}
                  placeholder="参数名"
                  title="参数名同时是导出文本里的键，上表后不要再改"
                  onChange={(event) => onUpdateParam(def.uid, param.uid, { name: event.target.value })}
                />
              </td>
              <td>
                <select
                  value={param.source}
                  title="这个参数的值从哪儿来"
                  onChange={(event) =>
                    onUpdateParam(def.uid, param.uid, { source: event.target.value as ParamSource })
                  }
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={param.options.join(',')}
                  placeholder={param.source === 'fixed' ? '例如 +,-,=' : '（只有固定选项能填）'}
                  disabled={param.source !== 'fixed'}
                  onChange={(event) =>
                    onUpdateParam(def.uid, param.uid, { options: splitOptions(event.target.value) })
                  }
                />
              </td>
              <td>
                <select
                  value={param.required ? 'required' : 'optional'}
                  title="必填的参数没填，校验会报错"
                  onChange={(event) =>
                    onUpdateParam(def.uid, param.uid, {
                      required: event.target.value === 'required',
                    })
                  }
                >
                  <option value="required">必填</option>
                  <option value="optional">非必填</option>
                </select>
              </td>
              <td>
                <input
                  value={param.note}
                  placeholder="给策划看的说明"
                  onChange={(event) => onUpdateParam(def.uid, param.uid, { note: event.target.value })}
                />
              </td>
              <td>
                <div className="row-actions">
                  <button
                    type="button"
                    className="mini"
                    title="往上挪一位（填表时控件顺序跟着变）"
                    disabled={index === 0}
                    onClick={() => onMoveParam(def.uid, param.uid, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="mini"
                    title="往下挪一位"
                    disabled={index === def.params.length - 1}
                    onClick={() => onMoveParam(def.uid, param.uid, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="mini danger"
                    onClick={() => onRemoveParam(def.uid, param.uid)}
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="command-add" onClick={() => onAddParam(def.uid)}>
        ＋ 新增参数
      </button>
    </div>
  );

  return (
    <div className="command-body">
      <aside className="command-side">
        {SECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className={section === item ? 'command-nav active' : 'command-nav'}
            onClick={() => setSection(item)}
          >
            {item}
            <span className="command-nav-count">
              {project.commands.filter((def) => def.category === item).length}
            </span>
          </button>
        ))}
      </aside>

      <div className="editor" ref={editorRef}>
        <div className="editor-head">
          <h2>条件与指令</h2>
          <div className="tab-row">
            <button
              type="button"
              className={tab === 'dict' ? 'tab active' : 'tab'}
              onClick={() => setTab('dict')}
            >
              {section}字典（{defs.length}）
            </button>
            <button
              type="button"
              className={tab === 'usage' ? 'tab active' : 'tab'}
              onClick={() => setTab('usage')}
            >
              使用情况（{usage.length}）
            </button>
          </div>
          {tab === 'dict' && (
            <button type="button" className="primary" onClick={() => onAddDef(section)}>
              ＋ 新增{section}
            </button>
          )}
        </div>

        {tab === 'dict' ? (
          <>
            <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
              {section}的写法是「主指令 | 分支 | 参数名:值;…」。这里定好参数后，
              剧情里填写时先选主指令，有分支再选分支，然后按下面的参数顺序从左到右填。
              参数名会写进导出文本，<strong>上表之后不要再改名</strong>。
            </p>

            {defs.length === 0 && (
              <div className="empty-state">
                还没有{section}。点右上角「＋ 新增{section}」，先写主指令名，再加参数。
              </div>
            )}

            {defs.map((def) => (
              <div
                className={`command-def-card${focusUid === def.uid ? ' flash' : ''}`}
                key={def.uid}
                data-search-uid={def.uid}
              >
                <div className="command-def-head">
                  <label className="command-def-field">
                    <span>主指令</span>
                    <input
                      value={def.head}
                      placeholder="例如 剧情"
                      onChange={(event) => onUpdateDef(def.uid, { head: event.target.value })}
                    />
                  </label>
                  <label className="command-def-field">
                    <span>分支</span>
                    <input
                      value={def.branch}
                      placeholder="（无分支）"
                      onChange={(event) => onUpdateDef(def.uid, { branch: event.target.value })}
                    />
                  </label>
                  <label className="command-def-field grow">
                    <span>指令说明</span>
                    <input
                      value={def.note}
                      placeholder="给策划看的说明"
                      onChange={(event) => onUpdateDef(def.uid, { note: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className={expanded === def.uid ? 'tab active' : 'tab'}
                    onClick={() => setExpanded(expanded === def.uid ? null : def.uid)}
                  >
                    参数（{def.params.length}）
                  </button>
                  <button
                    type="button"
                    className="mini danger"
                    onClick={() => onRemoveDef(def.uid)}
                  >
                    删除
                  </button>
                </div>
                {expanded === def.uid && renderParams(def)}
              </div>
            ))}
          </>
        ) : usage.length === 0 ? (
          <div className="empty-state">
            还没有用到任何{section}。在{
              section === '条件' ? '选项的出现/可用条件' : '对话行的指令栏'
            }里填写后会汇总到这里。
          </div>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
              共 {usage.length} 种，点「位置」跳到用到它的那一行。
            </p>
            <table className="lines">
              <thead>
                <tr>
                  <th>原文</th>
                  <th style={{ width: 100 }}>主指令</th>
                  <th style={{ width: 100 }}>分支</th>
                  <th>参数</th>
                  <th style={{ width: 60 }}>使用</th>
                  <th style={{ width: 260 }}>位置</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((entry) => {
                  const parsed = entry.broken ? null : parseCommandText(entry.text);
                  return (
                    <tr className="line-row" key={entry.text}>
                      <td className="command-cell">{entry.text}</td>
                      <td className="command-cell">{parsed?.head ?? '—'}</td>
                      <td className="command-cell">{parsed?.branch ?? ''}</td>
                      <td className="command-cell">
                        {entry.def === undefined ? (
                          <span className="command-missing">字典里没有这条</span>
                        ) : (
                          (parsed?.params ?? [])
                            .map((param) => `${param.name}:${param.value}`)
                            .join(';')
                        )}
                      </td>
                      <td className="command-cell">{entry.count}</td>
                      <td>
                        <div className="command-locations">
                          {entry.locations.slice(0, 3).map((location, index) => (
                            <button
                              key={`${location.lineUid}-${index}`}
                              type="button"
                              className="mini"
                              title={location.label}
                              onClick={() => onJumpToLine(location.lineUid)}
                            >
                              {location.label}
                            </button>
                          ))}
                          {entry.locations.length > 3 && (
                            <span className="hint">等 {entry.locations.length} 处</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
