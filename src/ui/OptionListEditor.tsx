import { useEffect, useRef } from 'react';

import type { CommandTargets } from '../core/command-build';
import { lineSequenceOf } from '../core/ids';
import type { Character, CommandDef, Group, Line, StoryOption } from '../core/types';
import { groupUidOfLine, type GroupLineRefs } from '../state/operations';
import { CommandListInput } from './CommandListInput';

interface Props {
  line: Line;
  group: Group;
  groupedLines: GroupLineRefs[];
  characters: Character[];
  commandDefs: CommandDef[];
  commandTargets: CommandTargets;
  /** 从流程图点选项标签跳过来的那个选项，短暂高亮 */
  flashOptionUid: string | null;
  onUpdateOption: (optionUid: string, patch: Partial<StoryOption>) => void;
  onAddOption: () => void;
  onRemoveOption: (optionUid: string) => void;
  onJumpToLine: (lineUid: string) => void;
}

/** 空值表示对话结束，导出时这一格留空 */
const JUMP_END = '';

/**
 * 跳转目标下拉里的条目：只写「段内序号 - 台词」。
 *
 * 完整 ID（Dia_ch01_001-22）太长，下拉里挤成一团也看不清；
 * 序号在同一段落里是唯一的，导出照旧用完整 ID。
 */
function lineOptionLabel(line: { readableId: string; preview: string }): string {
  const sequence = lineSequenceOf(line.readableId);
  const head = sequence === '' ? line.readableId : sequence;
  return line.preview === '' ? head : `${head} - ${line.preview}`;
}

/**
 * 跳转目标的两级下拉：先选段落，再选该段落里的对话 ID。
 * 第一级选「（对话结束）」时第二级禁用，导出留空。
 */
function JumpTargetSelects({
  value,
  groupedLines,
  onChange,
  onJump,
}: {
  value: string;
  groupedLines: GroupLineRefs[];
  onChange: (next: string) => void;
  onJump: (lineUid: string) => void;
}) {
  const groupUid = groupUidOfLine(groupedLines, value);
  const dangling = value !== '' && groupUid === '';
  const current = groupedLines.find((item) => item.groupUid === groupUid);

  return (
    <div className="jump-selects">
      <select
        value={dangling ? '__dangling__' : groupUid}
        title="第一级：目标段落"
        onChange={(event) => {
          const next = event.target.value;
          if (next === JUMP_END) {
            onChange(JUMP_END);
            return;
          }
          if (next === '__dangling__') return;
          const target = groupedLines.find((item) => item.groupUid === next);
          // 切到新段落时默认选中该段落的第一行，避免出现「有段落没对话」的空档
          onChange(target?.lines[0]?.uid ?? JUMP_END);
        }}
      >
        <option value={JUMP_END}>（对话结束）</option>
        {dangling && <option value="__dangling__">（目标已失效）</option>}
        {groupedLines.map((item) => (
          <option key={item.groupUid} value={item.groupUid}>
            {item.label}
          </option>
        ))}
      </select>

      <div className="jump-row">
        <select
          value={current === undefined ? '' : value}
          disabled={current === undefined}
          title="第二级：该段落内的对话（序号 - 台词）"
          onChange={(event) => onChange(event.target.value)}
        >
          {current === undefined || current.lines.length === 0 ? (
            <option value="">—</option>
          ) : (
            current.lines.map((line) => (
              <option key={line.uid} value={line.uid}>
                {lineOptionLabel(line)}
              </option>
            ))
          )}
        </select>

        <button
          type="button"
          className="jump-button"
          disabled={value === '' || dangling}
          title="跳转到目标对话"
          onClick={() => onJump(value)}
        >
          跳转
        </button>
      </div>
    </div>
  );
}

/**
 * 「选项」行里的选项列表。
 *
 * 一个选项 = 一句选项文本 + 出现/可用条件 + 结果指令 + 跳转目标，
 * 这些原本挂在对话行的「选项」按钮下，现在整体搬进「选项」行。
 */
export function OptionListEditor(props: Props) {
  const { line, group } = props;
  const flashRef = useRef<HTMLDivElement | null>(null);

  // 从流程图点选项标签过来时，把那个选项滚到视野中间
  useEffect(() => {
    if (props.flashOptionUid === null) return;
    flashRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [props.flashOptionUid]);

  const optionFields = (option: StoryOption, index: number) => {
    const flashing = option.uid === props.flashOptionUid;
    return (
      <div
        className={`option-item${flashing ? ' flash' : ''}`}
        key={option.uid}
        ref={flashing ? flashRef : undefined}
      >
      <div className="option-head">
        <span className="option-tag">{String.fromCharCode(65 + (index % 26))}</span>
        <span className="option-id">{option.readableId}</span>
        <button type="button" onClick={() => props.onRemoveOption(option.uid)}>
          删除选项
        </button>
      </div>

      <div className="option-fields">
        {/* 顺序按策划的填写习惯：先写选项文本，紧接着就是跳到哪去，再是条件与结果 */}
        <label className="field field-text">
          <span>选项文本（中文）</span>
          <textarea
            rows={2}
            value={option.text.zh}
            onChange={(event) =>
              props.onUpdateOption(option.uid, {
                text: { ...option.text, zh: event.target.value },
              })
            }
          />
        </label>

        <div className="field">
          <span>跳转目标</span>
          <JumpTargetSelects
            value={option.nextId}
            groupedLines={props.groupedLines}
            onChange={(next) => props.onUpdateOption(option.uid, { nextId: next })}
            onJump={props.onJumpToLine}
          />
        </div>

        <div className="field field-condition">
          <span>出现条件</span>
          <CommandListInput
            value={option.appearConditions}
            defs={props.commandDefs}
            category="条件"
            targets={props.commandTargets}
            expressionsOf={(id) => props.characters.find((c) => c.id === id)?.expressions ?? []}
            actionsOf={(id) => props.characters.find((c) => c.id === id)?.actions ?? []}
            onChange={(next) => props.onUpdateOption(option.uid, { appearConditions: next })}
            addLabel="＋ 新增条件"
            emptyHint="尚未设置出现条件"
          />
        </div>

        <div className="field field-condition">
          <span>可用条件</span>
          <CommandListInput
            value={option.enableConditions}
            defs={props.commandDefs}
            category="条件"
            targets={props.commandTargets}
            expressionsOf={(id) => props.characters.find((c) => c.id === id)?.expressions ?? []}
            actionsOf={(id) => props.characters.find((c) => c.id === id)?.actions ?? []}
            onChange={(next) => props.onUpdateOption(option.uid, { enableConditions: next })}
            addLabel="＋ 新增条件"
            emptyHint="尚未设置可用条件"
          />
        </div>

        <div className="field field-result">
          <span>结果（指令）</span>
          <CommandListInput
            value={option.results}
            defs={props.commandDefs}
            category="指令"
            targets={props.commandTargets}
            expressionsOf={(id) => props.characters.find((c) => c.id === id)?.expressions ?? []}
            actionsOf={(id) => props.characters.find((c) => c.id === id)?.actions ?? []}
            onChange={(next) => props.onUpdateOption(option.uid, { results: next })}
            addLabel="＋ 新增结果"
            emptyHint="选中后执行的指令"
          />
        </div>
      </div>
    </div>
    );
  };

  return (
    <div className="option-editor">
      {line.optionIds.map((optionUid, optionIndex) => {
        const option = group.options.find((o) => o.uid === optionUid);
        if (option === undefined) {
          return (
            <div className="option-item dangling" key={optionUid}>
              选项引用已失效，请删除后重建
            </div>
          );
        }
        return optionFields(option, optionIndex);
      })}

      {line.optionIds.length === 0 && (
        <div className="option-empty">这个「选项」行里还没有选项，点下面的加号新增。</div>
      )}

      <button type="button" className="option-add" title="新增选项" onClick={props.onAddOption}>
        ＋
      </button>
    </div>
  );
}
