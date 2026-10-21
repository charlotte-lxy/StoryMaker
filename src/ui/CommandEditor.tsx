import { useEffect, useState } from 'react';

import { useScrollMemory } from './view-memory';

import { collectCommands, commandModulesOf } from '../state/operations';
import { parseCommandText } from '../core/command-build';
import type { CommandDef, CommandParamDef, ParamSource, Project } from '../core/types';

interface Props {
  project: Project;
  onJumpToLine: (lineUid: string) => void;
  /** 新增 / 删除 / 改名一个模块（主指令） */
  onAddModule: (category: '条件' | '指令', head: string) => void;
  onRemoveModule: (category: '条件' | '指令', head: string) => void;
  onRenameModule: (category: '条件' | '指令', from: string, to: string) => void;
  /** 往模块里加一条条目、删一条条目、改分支名 */
  onAddDef: (category: '条件' | '指令', head: string) => void;
  onRemoveDef: (uid: string) => void;
  onRenameBranch: (defUid: string, to: string) => void;
  onUpdateDef: (uid: string, patch: Partial<CommandDef>) => void;
  onAddParam: (defUid: string) => void;
  onRemoveParam: (defUid: string, paramUid: string) => void;
  onUpdateParam: (defUid: string, paramUid: string, patch: Partial<CommandParamDef>) => void;
  onRenameParam: (defUid: string, paramUid: string, name: string) => void;
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
 * 可以「改完再生效」的名字输入框。
 *
 * 模块名 / 分支名 / 参数名一改，剧情里用到它的指令也要跟着改，
 * 逐字生效会把指令文本改得乱七八糟，所以改成失焦或回车时才提交；
 * 名字被占用（validate 返回 false）就退回原来的值。
 */
function NameInput({
  value,
  placeholder,
  title,
  className,
  validate,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  title?: string;
  className?: string;
  validate: (next: string) => boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // 外面改了（比如撤销、改名被拒），跟着回到实际值
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    const next = draft.trim();
    if (next !== value.trim() && validate(next)) onCommit(next);
    setDraft(value);
  };

  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      title={title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * 条件与指令模块。
 *
 * 左边一栏分「条件 / 指令」两页：条件用在选项的出现/可用条件上，指令用在对话行的指令栏上。
 * 每页两个页签：字典（按模块分组，每条条目有哪些参数）与使用情况（剧情里哪些地方用了它）。
 *
 * 字典按「模块（主指令）」分组：分组标题上写模块名，分组里一条条条目只写分支与参数。
 * 改模块名 / 分支名 / 参数名都会把剧情里用到它的指令一起改掉，引用不会断。
 */
export function CommandEditor({
  project,
  onJumpToLine,
  onAddModule,
  onRemoveModule,
  onRenameModule,
  onAddDef,
  onRemoveDef,
  onRenameBranch,
  onUpdateDef,
  onAddParam,
  onRemoveParam,
  onUpdateParam,
  onRenameParam,
  onMoveParam,
  focusUid = null,
}: Props) {
  const editorRef = useScrollMemory('command');
  const [section, setSection] = useState<Section>('指令');
  const [tab, setTab] = useState<'dict' | 'usage'>('dict');
  /** 正在填的「新增分组」名字（null = 没在新增） */
  const [newHead, setNewHead] = useState<string | null>(null);

  // 跳过来的那一行：先切到它所在的类别与「字典」页
  useEffect(() => {
    if (focusUid === null) return;
    const def = project.commands.find((item) => item.uid === focusUid);
    if (def === undefined) return;
    setSection(def.category);
    setTab('dict');
  }, [focusUid, project.commands]);

  useEffect(() => {
    if (focusUid === null || tab !== 'dict') return;
    document.querySelector(`[data-search-uid="${focusUid}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusUid, tab, section]);

  const modules = commandModulesOf(project, section);
  const defCount = modules.reduce((sum, module) => sum + module.defs.length, 0);
  const usage = collectCommands(project, section);

  /** 模块名在本页里是否可用（不能和别的模块重名） */
  const moduleNameFree = (next: string, current: string): boolean =>
    next !== '' && !modules.some((module) => module.head === next && module.head !== current);

  /** 分支名在同一个模块里是否可用 */
  const branchNameFree = (defs: CommandDef[], current: string, next: string): boolean =>
    !defs.some((def) => def.branch.trim() === next && def.branch.trim() !== current.trim());

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
                <NameInput
                  value={param.name}
                  placeholder="参数名"
                  title="参数名同时是导出文本里的键，改这里剧情里用到它的指令一起改"
                  validate={(next) =>
                    next !== '' &&
                    !def.params.some(
                      (item) => item.uid !== param.uid && item.name.trim() === next,
                    )
                  }
                  onCommit={(next) => onRenameParam(def.uid, param.uid, next)}
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
            onClick={() => {
              setSection(item);
              setNewHead(null);
            }}
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
              {section}字典（{defCount}）
            </button>
            <button
              type="button"
              className={tab === 'usage' ? 'tab active' : 'tab'}
              onClick={() => setTab('usage')}
            >
              使用情况（{usage.length}）
            </button>
          </div>
        </div>

        {tab === 'dict' ? (
          <>
            <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
              按<strong>模块</strong>分组：分组名就是主指令（同一页里不能重名），分组里的条目写
              <strong>分支</strong>（同一个模块里不能重名）与参数。指令写法是
              「主指令 | 分支 | 参数名:值;…」；改模块名 / 分支名 / 参数名时，
              剧情里用到它们的指令会一起改，不会断。
            </p>

            {modules.length === 0 && (
              <div className="empty-state">
                还没有{section}。点下面的「＋ 新增分组」，先写模块名，再往里加条目。
              </div>
            )}

            {modules.map((module) => (
              <section className="command-group" key={module.head}>
                <header className="command-group-head">
                  <span className="command-group-title">模块</span>
                  <NameInput
                    className="command-group-name"
                    value={module.head}
                    placeholder="模块名，比如 剧情"
                    title="模块名（主指令）：改这里，剧情里用到它的指令一起改；同一页里不能重名"
                    validate={(next) => moduleNameFree(next, module.head)}
                    onCommit={(next) => onRenameModule(section, module.head, next)}
                  />
                  <span className="hint">{module.defs.length} 条条目</span>
                  <button
                    type="button"
                    className="mini"
                    title="在这个模块里加一条条目"
                    onClick={() => onAddDef(section, module.head)}
                  >
                    ＋ 新增条目
                  </button>
                  <button
                    type="button"
                    className="mini danger"
                    title="连同这个模块下的所有条目一起删掉"
                    onClick={() => onRemoveModule(section, module.head)}
                  >
                    删除分组
                  </button>
                </header>

                {module.defs.map((def) => (
                  <div
                    className={`command-def-card${focusUid === def.uid ? ' flash' : ''}`}
                    key={def.uid}
                    data-search-uid={def.uid}
                  >
                    <div className="command-def-head">
                      <label className="command-def-field">
                        <span>分支</span>
                        <NameInput
                          value={def.branch}
                          placeholder="（无分支）"
                          title="分支名：同一个模块里不能重名；改这里，用到它的指令一起改"
                          validate={(next) => branchNameFree(module.defs, def.branch, next)}
                          onCommit={(next) => onRenameBranch(def.uid, next)}
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
                        className="mini danger"
                        onClick={() => onRemoveDef(def.uid)}
                      >
                        删除条目
                      </button>
                    </div>
                    {renderParams(def)}
                  </div>
                ))}
              </section>
            ))}

            <div className="command-add-group">
              {newHead === null ? (
                <button type="button" className="command-add" onClick={() => setNewHead('')}>
                  ＋ 新增分组
                </button>
              ) : (
                <>
                  <input
                    autoFocus
                    className="command-group-name"
                    value={newHead}
                    placeholder="新模块名，比如 剧情"
                    title="模块名就是主指令，同一页里不能重名"
                    onChange={(event) => setNewHead(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setNewHead(null);
                      if (event.key !== 'Enter') return;
                      const next = newHead.trim();
                      if (moduleNameFree(next, '')) {
                        onAddModule(section, next);
                        setNewHead(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={!moduleNameFree(newHead.trim(), '')}
                    onClick={() => {
                      onAddModule(section, newHead.trim());
                      setNewHead(null);
                    }}
                  >
                    添加
                  </button>
                  <button type="button" onClick={() => setNewHead(null)}>
                    取消
                  </button>
                  {newHead.trim() !== '' && !moduleNameFree(newHead.trim(), '') && (
                    <span className="field-error">模块名重复了，换一个</span>
                  )}
                </>
              )}
            </div>
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
