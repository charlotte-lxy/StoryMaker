import { useState } from 'react';

import {
  buildCommandText,
  commandDefNote,
  findCommandDef,
  isReferenceSource,
  paramTitle,
  paramValuesOf,
  parseCommandText,
  targetsOfSource,
  type CommandTargets,
} from '../core/command-build';
import type { CommandDef, CommandParamDef } from '../core/types';

/**
 * 指令 / 条件的条目式填写。
 *
 * 一条指令 = 主指令 + 分支 + 参数列表，界面上逐级来：
 *   1. 先只摆「主指令」下拉；
 *   2. 该主指令在字典里有分支时，再摆「分支」下拉；
 *   3. 选中后按参数列表的顺序，从左到右摆每个参数的控件。
 *
 * 拼出来的文本就是导出用的那一条（`主指令|分支|参数名:值;参数名:值`），
 * 存在 Line.command / 选项的条件数组里，文本本身是唯一事实。
 *
 * category 用来把范围限定在字典的某一部分：选项的出现/可用条件只能选「条件」，
 * 对话行的指令栏只能选「指令」。两边的格式一样，混在一起会选错。
 */
interface Props {
  value: string[];
  /** 全部指令定义；组件内部按 category 过滤 */
  defs: CommandDef[];
  /** 限定只能选哪一类 */
  category: '条件' | '指令';
  targets: CommandTargets;
  /** 取某个角色（角色 uid）的表情或动作清单 */
  expressionsOf: (characterUid: string) => string[];
  actionsOf: (characterUid: string) => string[];
  onChange: (next: string[]) => void;
  addLabel?: string;
  emptyHint?: string;
  showAdd?: boolean;
  showRemove?: boolean;
}

/** 主指令下拉里的一项（同名只列一次） */
function headOptions(defs: readonly CommandDef[]): string[] {
  const heads: string[] = [];
  for (const def of defs) {
    const head = def.head.trim();
    if (head !== '' && !heads.includes(head)) heads.push(head);
  }
  return heads;
}

/** 单个参数控件：值来源决定它是下拉还是输入框 */
function ParamControl({
  param,
  value,
  characterUid,
  targets,
  expressionsOf,
  actionsOf,
  onChange,
}: {
  param: CommandParamDef;
  value: string;
  /** 同一条指令里「角色表」那个参数当前选的角色 */
  characterUid: string;
  targets: CommandTargets;
  expressionsOf: (characterUid: string) => string[];
  actionsOf: (characterUid: string) => string[];
  onChange: (next: string) => void;
}) {
  const title = paramTitle(param);
  const placeholder = param.required ? null : <option value="">（不填）</option>;

  if (param.source === 'fixed') {
    return (
      <select
        className="command-param-input"
        value={value}
        title={title}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder}
        {param.options.length === 0 && <option value="">（选项集为空）</option>}
        {param.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {value !== '' && !param.options.includes(value) && (
          <option value={value}>{value}（不在选项集里）</option>
        )}
      </select>
    );
  }

  if (isReferenceSource(param.source)) {
    const rows = targetsOfSource(targets, param.source);
    const known = rows.some((row) => row.id === value);
    return (
      <select
        className="command-param-input"
        value={value}
        title={title}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder}
        {rows.length === 0 && <option value="">（对应表里还没有数据）</option>}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
        {value !== '' && !known && <option value={value}>{value}（不在对应表里）</option>}
      </select>
    );
  }

  if (param.source === 'expression' || param.source === 'action') {
    const rows =
      param.source === 'expression' ? expressionsOf(characterUid) : actionsOf(characterUid);
    return (
      <select
        className="command-param-input"
        value={value}
        title={title}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder}
        {characterUid === '' && <option value="">（先选角色）</option>}
        {characterUid !== '' && rows.length === 0 && <option value="">（这个角色还没配）</option>}
        {rows.map((row) => (
          <option key={row} value={row}>
            {row}
          </option>
        ))}
        {value !== '' && !rows.includes(value) && (
          <option value={value}>{value}（不在清单里）</option>
        )}
      </select>
    );
  }

  return (
    <input
      className="command-param-input"
      value={value}
      title={title}
      placeholder={param.source === 'number' ? '数字' : param.name}
      onChange={(event) => onChange(event.target.value)}
    />
  );
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
  showAdd = true,
  showRemove = true,
}: Props) {
  const available = defs.filter((def) => def.category === category);
  const heads = headOptions(available);
  /** 选了主指令、但还没选分支时的中间状态（这时候文本里什么都存不下） */
  const [draftHeads, setDraftHeads] = useState<Record<number, string>>({});
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
    <div className="command-list">
      {value.map((text, index) => {
        const parsed = parseCommandText(text);
        const def =
          parsed === null
            ? undefined
            : findCommandDef(available, category, parsed.head, parsed.branch);
        const head = parsed?.head ?? draftHeads[index] ?? '';
        const defsOfHead = available.filter((item) => item.head.trim() === head);
        const hasBranch = defsOfHead.some((item) => item.branch.trim() !== '');
        const values = paramValuesOf(parsed);
        /** 表情 / 动作 这类参数要先知道同一条指令里选的是哪个角色 */
        const characterParam = def?.params.find((param) => param.source === 'character');
        const characterUid = characterParam === undefined ? '' : (values[characterParam.name] ?? '');
        const raw = text.trim();
        const unmatched = raw !== '' && def === undefined;

        const setHead = (nextHead: string): void => {
          const list = available.filter((item) => item.head.trim() === nextHead);
          if (nextHead === '' || list.length === 0) {
            updateAt(index, '');
            setDraftHeads((prev) => ({ ...prev, [index]: '' }));
            return;
          }
          if (list.length === 1) {
            updateAt(index, buildCommandText(list[0], {}));
            setDraftHeads((prev) => ({ ...prev, [index]: '' }));
            return;
          }
          // 有分支：先把主指令记在本地，等分支选完再拼文本
          setDraftHeads((prev) => ({ ...prev, [index]: nextHead }));
          updateAt(index, '');
        };

        const setBranch = (nextBranch: string): void => {
          const picked = defsOfHead.find((item) => item.branch.trim() === nextBranch);
          if (picked === undefined) return;
          updateAt(index, buildCommandText(picked, {}));
          setDraftHeads((prev) => ({ ...prev, [index]: '' }));
        };

        const setParam = (param: CommandParamDef, nextValue: string): void => {
          if (def === undefined) return;
          updateAt(index, buildCommandText(def, { ...values, [param.name]: nextValue }));
        };

        return (
          <div
            className={[
              'command-item',
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
            {showRemove && (
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

            <select
              className="command-head"
              value={head}
              title={`选择${category}（主指令）`}
              onChange={(event) => setHead(event.target.value)}
            >
              <option value="">选择{category}…</option>
              {heads.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              {unmatched && <option value="">（字典里没有这条）</option>}
            </select>

            {hasBranch && (
              <select
                className="command-branch"
                value={def?.branch ?? ''}
                title="分支"
                onChange={(event) => setBranch(event.target.value)}
              >
                <option value="">选择分支…</option>
                {defsOfHead.map((item) => (
                  <option key={item.uid} value={item.branch.trim()} title={commandDefNote(item)}>
                    {item.branch.trim() === '' ? '（无分支）' : item.branch.trim()}
                  </option>
                ))}
              </select>
            )}

            {def?.params.map((param) => (
              <span className="command-param" key={param.uid}>
                <span className="command-param-name" title={paramTitle(param)}>
                  {param.name}
                </span>
                <ParamControl
                  param={param}
                  value={values[param.name] ?? ''}
                  characterUid={characterUid}
                  targets={targets}
                  expressionsOf={expressionsOf}
                  actionsOf={actionsOf}
                  onChange={(next) => setParam(param, next)}
                />
              </span>
            ))}

            {unmatched && (
              <code className="command-raw" title="字典里没有这条指令，导出时原样写出">
                {raw}
              </code>
            )}

            {raw === '' && (
              <span className="command-empty-hint" aria-hidden="true">
                {emptyHint}
              </span>
            )}

            {showRemove && (
              <button type="button" title="删除这一条" onClick={() => removeAt(index)}>
                ×
              </button>
            )}
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
 * 复用条目式的逐级下拉，只是没有增删按钮——增删由「指令」行自己的删除按钮负责。
 */
export function CommandInput(
  props: Omit<Props, 'value' | 'onChange' | 'addLabel' | 'emptyHint' | 'showAdd' | 'showRemove'> & {
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
      emptyHint="还没选指令"
      showAdd={false}
      showRemove={false}
    />
  );
}
