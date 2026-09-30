import { useState } from 'react';

import {
  buildCommand,
  commandDefLabel,
  commandDefNote,
  matchCommandDef,
  targetsFor,
  type CommandTargets,
} from '../core/command-build';
import type { CommandDef } from '../core/types';
import { parseCommand } from '../state/operations';

/**
 * 指令 / 条件的条目式填写。
 *
 * 第一行是可编辑的文本框——既能直接手写，也会被下面的下拉选择覆盖。
 * 下面一排下拉从指令字典取值，逐级联动。
 *
 * category 用来把范围限定在字典的某一部分：选项的出现/可用条件只能选「条件」，
 * 对话行的指令栏和选项的结果只能选「指令」。两边的格式一样，混在一起会选错。
 */
interface Props {
  value: string[];
  /** 全部指令定义；组件内部按 category 过滤 */
  defs: CommandDef[];
  /** 限定只能选哪一类 */
  category: '条件' | '指令';
  targets: CommandTargets;
  /** 取某个角色的表情或动作清单（传的是角色的 uid） */
  expressionsOf: (characterUid: string) => string[];
  actionsOf: (characterUid: string) => string[];
  onChange: (next: string[]) => void;
  addLabel?: string;
  emptyHint?: string;
  /** 单条填写：预览与下拉横向排成一行（「指令」行用这个） */
  inline?: boolean;
  showAdd?: boolean;
  showRemove?: boolean;
}

interface Draft {
  defUid: string;
  target: string;
  value: string;
}

/**
 * 从已经写好的指令文本反推下拉框的选择。
 *
 * 切换模块时组件会被卸载重建，光靠本地 state 记住「选过什么」是不够的：
 * 回来之后下拉就变回「选择指令…」了。指令文本本身才是唯一事实，
 * 所以这里把它解析回下拉的选项。
 *
 * 目标那一格存的是 uid，uid 里带 `-`，解析时要先把 uid 认出来（见 parseCommand）。
 */
function draftFromText(text: string, available: CommandDef[], targets: CommandTargets): Draft {
  const parsed = parseCommand(text, (value) => targets.uids.has(value));
  if (parsed === null) return { defUid: '', target: '', value: '' };

  const def = matchCommandDef(parsed, available, targets);
  return { defUid: def === undefined ? '' : def.uid, target: parsed.target, value: parsed.value };
}

export function CommandListInput({
  value,
  defs,
  category,
  targets,
  expressionsOf,
  actionsOf,
  onChange,
  addLabel = '＋ 新增',
  emptyHint = '尚未填写',
  inline = false,
  showAdd = true,
  showRemove = true,
}: Props) {
  const available = defs.filter((def) => def.category === category);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const updateAt = (index: number, next: string): void => {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  };

  const removeAt = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  /** 条目之间也能拖动排序 */
  const moveTo = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= value.length) return;
    const copy = [...value];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChange(copy);
  };

  const append = (): void => onChange([...value, '']);

  return (
    <div className={`command-list${inline ? ' inline' : ''}`}>
      {value.map((text, index) => {
        const draft = drafts[index] ?? draftFromText(text, available, targets);
        const def = available.find((item) => item.uid === draft.defUid);
        const candidates = def === undefined ? [] : targetsFor(def, targets);
        const missingTarget =
          def !== undefined &&
          draft.target !== '' &&
          !candidates.some((item) => item.id === draft.target);

        // 结果候选：表情/动作依赖所选角色
        const valueOptions = ((): string[] => {
          if (def === undefined) return [];
          if (def.value === 'expression') return expressionsOf(draft.target);
          if (def.value === 'action') return actionsOf(draft.target);
          if (def.value === 'fixed') return def.fixedValues;
          return [];
        })();

        return (
          <div
            className={[
              'command-item',
              inline ? 'inline' : '',
              dragIndex === index ? 'dragging' : '',
              dragIndex !== null && overIndex === index && dragIndex !== index
                ? 'drop-target'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={index}
            onDragOver={(event) => {
              if (dragIndex === null) return;
              event.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null) moveTo(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <div className="command-item-head">
              {!inline && (
                <span
                  className="drag-handle command-drag"
                  title="按住上下拖动可调整顺序"
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                />
              )}
              {/* 第一行既能手写，也会被下面的下拉覆盖。
                  条目式的列表用不可见文本副本把宽度撑开；「指令」行的单条填写
                  宽度固定，免得整行跟着内容忽宽忽窄。 */}
              {inline ? (
                <input
                  className="command-text-inline"
                  value={text}
                  placeholder={emptyHint}
                  onChange={(event) => updateAt(index, event.target.value)}
                />
              ) : (
                <span className="command-field">
                  <span className="command-probe" aria-hidden="true">
                    {text === '' ? emptyHint : text}
                  </span>
                  <input
                    className="command-text-input"
                    value={text}
                    placeholder={emptyHint}
                    onChange={(event) => updateAt(index, event.target.value)}
                  />
                </span>
              )}
              {showRemove && (
                <button type="button" title="删除这一条" onClick={() => removeAt(index)}>
                  ×
                </button>
              )}
            </div>

            <div className="command-pickers">
              <select
                value={draft.defUid}
                title={`选择${category}`}
                onChange={(event) => {
                  const defUid = event.target.value;
                  const picked = available.find((item) => item.uid === defUid);
                  const firstTarget =
                    picked === undefined ? '' : (targetsFor(picked, targets)[0]?.id ?? '');
                  const firstValue =
                    picked === undefined
                      ? ''
                      : picked.value === 'expression'
                        ? (expressionsOf(firstTarget)[0] ?? '')
                        : picked.value === 'action'
                          ? (actionsOf(firstTarget)[0] ?? '')
                          : picked.value === 'fixed'
                            ? (picked.fixedValues[0] ?? '')
                            : '';
                  setDrafts((prev) => ({
                    ...prev,
                    [index]: { defUid, target: firstTarget, value: firstValue },
                  }));
                  if (picked !== undefined) {
                    updateAt(index, buildCommand(picked, firstTarget, firstValue));
                  }
                }}
              >
                <option value="">选择{category}…</option>
                {available.map((item) => (
                  <option key={item.uid} value={item.uid} title={commandDefNote(item)}>
                    {commandDefLabel(item)}
                  </option>
                ))}
              </select>

              {def !== undefined && def.target !== 'none' && def.target !== 'manual' && (
                <select
                  value={draft.target}
                  title="目标对象"
                  onChange={(event) => {
                    const target = event.target.value;
                    const nextValue =
                      def.value === 'expression'
                        ? (expressionsOf(target)[0] ?? '')
                        : def.value === 'action'
                          ? (actionsOf(target)[0] ?? '')
                          : draft.value;
                    setDrafts((prev) => ({ ...prev, [index]: { ...draft, target, value: nextValue } }));
                    updateAt(index, buildCommand(def, target, nextValue));
                  }}
                >
                  {candidates.length === 0 && <option value="">（对应表里还没有数据）</option>}
                  {candidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                  {/* 手写或从老数据迁移过来的目标可能不在候选表里，也要显示出来 */}
                  {missingTarget && (
                    <option value={draft.target}>{draft.target}（不在候选里）</option>
                  )}
                </select>
              )}

              {(def?.target === 'manual' || def?.target === 'none') && (
                <input
                  value={draft.target}
                  placeholder={def?.target === 'none' ? '（无需目标）' : '手工填写目标'}
                  onChange={(event) => {
                    const target = event.target.value;
                    setDrafts((prev) => ({ ...prev, [index]: { ...draft, target } }));
                    updateAt(index, buildCommand(def, target, draft.value));
                  }}
                />
              )}

              {def !== undefined &&
                def.value !== 'none' &&
                (valueOptions.length > 0 ? (
                  <select
                    value={draft.value}
                    title="目标结果"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setDrafts((prev) => ({ ...prev, [index]: { ...draft, value: nextValue } }));
                      updateAt(index, buildCommand(def, draft.target, nextValue));
                    }}
                  >
                    <option value="">选择结果…</option>
                    {valueOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                    {draft.value !== '' && !valueOptions.includes(draft.value) && (
                      <option value={draft.value}>{draft.value}（不在候选里）</option>
                    )}
                  </select>
                ) : (
                  <input
                    value={draft.value}
                    placeholder={def.value === 'number' ? '数量' : '结果'}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setDrafts((prev) => ({ ...prev, [index]: { ...draft, value: nextValue } }));
                      updateAt(index, buildCommand(def, draft.target, nextValue));
                    }}
                  />
                ))}
            </div>
          </div>
        );
      })}

      {showAdd && (
        <button
          type="button"
          className={value.length === 0 ? 'command-add empty' : 'command-add'}
          onClick={append}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

/**
 * 单条指令的填写（「指令」行用它：一行只放一条指令）。
 *
 * 复用条目式的预览 + 下拉，只是排成横向一行，也没有增删按钮——
 * 增删由「指令」行自己的删除按钮负责。
 */
export function CommandInput(
  props: Omit<Props, 'value' | 'onChange' | 'addLabel' | 'emptyHint'> & {
    value: string;
    onChange: (next: string) => void;
  },
) {
  const { value, onChange, ...rest } = props;
  return (
    <CommandListInput
      {...rest}
      value={value === '' ? [''] : [value]}
      onChange={(next) => onChange(next[0] ?? '')}
      emptyHint="点这里手写指令，或用右侧下拉选择"
      inline
      showAdd={false}
      showRemove={false}
    />
  );
}
