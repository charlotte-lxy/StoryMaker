import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import type { CommandTargets } from '../core/command-build';
import type { Character, CommandDef, Group, Line, StoryOption } from '../core/types';
import type { GroupLineRefs } from '../state/operations';
import { lineSequenceOf } from '../core/ids';
import { CommandInput } from './CommandListInput';
import { OptionListEditor } from './OptionListEditor';
import { LINES_MIME, blockKindOf, isBlockDrag, type BlockId } from './script-blocks';

/** 「跳转到段落」下拉里的一个候选段落 */
export interface GroupChoice {
  uid: string;
  label: string;
}

interface Props {
  group: Group;
  groupedLines: GroupLineRefs[];
  /** 本章的段落：供「跳转到段落」行选目标 */
  groupChoices: GroupChoice[];
  characters: Character[];
  /** 指令字典与各数据表整理出的下拉候选 */
  commandDefs: CommandDef[];
  commandTargets: CommandTargets;
  /** 刚被跳转过来的行，短暂高亮并滚动到可视区 */
  flashLineUid: string | null;
  /** 刚被跳转过来的选项（点流程图上的选项标签），短暂高亮 */
  flashOptionUid: string | null;
  onUpdateLine: (lineUid: string, patch: Partial<Line>) => void;
  onUpdateOption: (optionUid: string, patch: Partial<StoryOption>) => void;
  /** 在 index 位置插入一行（index 是插入点，等于行数表示追加到末尾） */
  onInsertLine: (index: number, blockId: BlockId) => void;
  onRemoveLine: (lineUid: string) => void;
  /** 拖拽排序，参数是段落内的起止下标 */
  onReorderLine: (from: number, to: number) => void;
  onAddOption: (lineUid: string) => void;
  onRemoveOption: (optionUid: string) => void;
  onJumpToLine: (lineUid: string) => void;
  /** 批量编辑模式：每行左边多一块勾选区（选择框 + 段内序号，整块都能点） */
  batchMode: boolean;
  /** 批量编辑里勾中的行 */
  selectedLineUids: string[];
  /** 勾选 / 取消勾选一行；extendRange 为真（按住 Shift）时改成勾上区间 */
  onToggleSelect: (lineUid: string, extendRange: boolean) => void;
  /** 批量编辑里拖动勾中的行：整组插到第 insertAt 行之前 */
  onMoveSelection: (insertAt: number) => void;
}

/** 一个字段：名称标在上方，输入框在下面 */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`line-field${className === undefined ? '' : ` ${className}`}`}>
      <span className="line-field-name">{label}</span>
      {children}
    </div>
  );
}

/**
 * 段落里的对话列表。
 *
 * 三种类型的行展示不同的字段，所以这里不用表格：每个字段把名称标在输入框上方，
 * 从左到右按类型排列。左上角的把手可以上下拖动调整顺序，
 * 左下角脚本块区拖进来的块会在插入标记处变成一行新数据。
 */
export function LineList(props: Props) {
  const { group, groupedLines } = props;
  /** 正在被拖动排序的行下标 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** 插入标记落在哪两行之间（0..行数） */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [noteUid, setNoteUid] = useState<string | null>(null);
  /** 正在编辑的那一行，整行换个底色提示"你现在改的是这行" */
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const flashCardRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 从别处跳转过来时，把目标行滚到视野中央
  useEffect(() => {
    if (props.flashLineUid === null) return;
    flashCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [props.flashLineUid]);

  // 拖拽不管在哪里结束（含中途取消），都要把插入标记收起来
  useEffect(() => {
    if (dropAt === null) return;
    const clear = () => setDropAt(null);
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, [dropAt]);

  const clearDrag = (): void => {
    setDragIndex(null);
    setDropAt(null);
  };

  /** 焦点离开整行才算结束编辑 */
  const handleBlur = (uid: string) => (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next === null || !event.currentTarget.contains(next)) {
      setEditingUid((current) => (current === uid ? null : current));
    }
  };

  /**
   * 指针落在哪两行之间：从上往下找第一条中线在指针下方的行。
   *
   * 拖放事件挂在整张列表上（不是每一行、也不是那条横线上），
   * 所以指针在横线正上方、行与行之间的空隙里都能插入。
   */
  const insertAtOf = (clientY: number): number => {
    const cards = Array.from(listRef.current?.querySelectorAll('.line-card') ?? []);
    let index = 0;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) break;
      index += 1;
    }
    return index;
  };

  const canDrop = (transfer: DataTransfer | null): boolean =>
    dragIndex !== null || isBlockDrag(transfer);

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!canDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragIndex === null ? 'copy' : 'move';
    setDropAt(insertAtOf(event.clientY));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!canDrop(event.dataTransfer)) return;
    event.preventDefault();

    const at = insertAtOf(event.clientY);
    const kind = blockKindOf(event.dataTransfer);
    const from = dragIndex;
    clearDrag();

    if (kind !== null) {
      props.onInsertLine(at, kind);
      return;
    }
    if (from === null) return;

    // 批量编辑里拖"勾中的行"：连它一起勾上的整组搬到插入点（拖没勾中的行还是只搬它自己）
    const dragged = group.lines[from];
    if (props.batchMode && dragged !== undefined && props.selectedLineUids.includes(dragged.uid)) {
      props.onMoveSelection(at);
      return;
    }
    // reorderLine 的 to 是"移走之后的下标"，插入点要换算一下
    props.onReorderLine(from, at > from ? at - 1 : at);
  };

  /** 按下时的元素：用来分辨这次拖拽是从输入框里起的，还是从空白处起的 */
  const pressedRef = useRef<EventTarget | null>(null);

  /** 输入控件里的拖拽是"选文字"，不是"搬这一行" */
  const fromControl = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null;

  /**
   * 点左侧勾选区的空白处（没点在选择框上）也算勾选。
   *
   * 选择框自己有 onChange，这里就不再处理它；顺手拦掉 label 对选择框的原生转发，
   * 否则同一次点击会被算两次。
   */
  const handleSelectAreaClick = (lineUid: string) => (event: ReactMouseEvent<HTMLLabelElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    props.onToggleSelect(lineUid, event.shiftKey);
  };

  return (
    <div className="line-list" ref={listRef} onDragOver={handleDragOver} onDrop={handleDrop}>
      {group.lines.map((line, index) => {
        const hasNote = line.note.trim() !== '';
        const sequence = lineSequenceOf(line.readableId) === '' ? String(index + 1) : lineSequenceOf(line.readableId);
        const selected = props.selectedLineUids.includes(line.uid);
        /** 段内序号：完整 ID 太长，这里只标 "-" 后面那截，完整 ID 放到悬浮提示里 */
        const sequenceTag = (
          <span className="line-seq" title={`对话 ID：${line.readableId}`}>
            {sequence}
          </span>
        );
        // 正在拖的这一行属于勾选集合时，整组都会跟着走，一起淡下去让人看得见
        const draggingGroup =
          props.batchMode &&
          dragIndex !== null &&
          props.selectedLineUids.includes(group.lines[dragIndex]?.uid ?? '');
        return (
          /* 一行 = 左侧勾选区（批量编辑时才在，含段内序号）+ 对话块本身 */
          <div
            key={line.uid}
            className={`line-row${editingUid === line.uid ? ' editing' : ''}${selected ? ' selected' : ''}`}
          >
            {props.batchMode ? (
              <label
                className="line-select-area"
                title="点这块区域勾选这一行；按住 Shift 点 = 勾上从上次点到这一行之间的全部行"
                onClick={handleSelectAreaClick(line.uid)}
              >
                <input
                  type="checkbox"
                  className="line-select"
                  checked={selected}
                  onChange={(event) =>
                    props.onToggleSelect(line.uid, (event.nativeEvent as MouseEvent).shiftKey === true)
                  }
                />
                {sequenceTag}
              </label>
            ) : (
              sequenceTag
            )}

            <article
              data-line-uid={line.uid}
              ref={props.flashLineUid === line.uid ? flashCardRef : undefined}
              /* 整行空白处都能按住拖动排序；正在编辑的那一行先不响应，
                 免得在输入框里拖选文字被当成搬行 */
              draggable={editingUid !== line.uid}
              onMouseDown={(event) => {
                pressedRef.current = event.target;
              }}
              onDragStart={(event) => {
                if (fromControl(pressedRef.current)) {
                  event.preventDefault();
                  return;
                }
                setDragIndex(index);
                event.dataTransfer.effectAllowed = 'move';
                // 批量编辑里拖勾中的行：带上标记，拖到流程图段落块上就等于「移动至」那个段落
                if (props.batchMode && selected) {
                  event.dataTransfer.setData(LINES_MIME, line.uid);
                }
              }}
              onDragEnd={clearDrag}
              className={[
                'line-card',
                `type-card-${line.kind}`,
                props.flashLineUid === line.uid ? 'flash' : '',
                dragIndex === index || (draggingGroup && selected) ? 'dragging' : '',
                editingUid === line.uid ? 'editing' : '',
                dropAt === index ? 'drop-before' : '',
                dropAt === index + 1 ? 'drop-after' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onFocus={() => setEditingUid(line.uid)}
              onBlur={handleBlur(line.uid)}
            >
                {/* 只是"这里能拖"的视觉提示，真正的拖拽挂在整行上 */}
                <span
                  className="drag-handle line-drag"
                  title="按住整行的空白处上下拖动可调整顺序，松手后自动重新编号"
                />
  
                <div className="line-fields">
                  <Field label="脚本类型" className="line-field-kind">
                    <span className={`type-tag type-${line.kind}`}>{line.kind}</span>
                  </Field>
  
                  {line.kind === '对话' && (
                    <>
                      <Field label="角色" className="line-field-character">
                        <select
                          value={line.characterId}
                          title="角色：导出时写入「角色ID」列"
                          onChange={(event) =>
                            props.onUpdateLine(line.uid, { characterId: event.target.value })
                          }
                        >
                          <option value="">（未指定）</option>
                          {props.characters.map((character) => (
                            <option key={character.uid} value={character.id}>
                              {character.name}
                            </option>
                          ))}
                          {line.characterId !== '' &&
                            !props.characters.some((c) => c.id === line.characterId) && (
                              <option value={line.characterId}>
                                {line.characterId}（不在角色表中）
                              </option>
                            )}
                        </select>
                        <input
                          value={line.displayName}
                          placeholder="显示名"
                          title="显示名：导出时写入「角色显示名称」列，留空则用角色 ID"
                          onChange={(event) =>
                            props.onUpdateLine(line.uid, { displayName: event.target.value })
                          }
                        />
                      </Field>
  
                      <Field label="台词（中文）" className="line-field-text">
                        <textarea
                          rows={2}
                          value={line.text.zh}
                          placeholder="中文台词"
                          onChange={(event) =>
                            props.onUpdateLine(line.uid, {
                              text: { ...line.text, zh: event.target.value },
                            })
                          }
                        />
                      </Field>
  
                      <Field label="强制自动播放" className="line-field-auto">
                        <input
                          type="checkbox"
                          checked={line.autoAdvance}
                          title="勾上后这一句播完自动进入下一句"
                          onChange={(event) =>
                            props.onUpdateLine(line.uid, { autoAdvance: event.target.checked })
                          }
                        />
                      </Field>
                    </>
                  )}
  
                  {line.kind === '选项' && (
                    <Field label="选项列表" className="line-field-options">
                      <OptionListEditor
                        line={line}
                        group={group}
                        groupedLines={groupedLines}
                        characters={props.characters}
                        commandDefs={props.commandDefs}
                        commandTargets={props.commandTargets}
                        flashOptionUid={props.flashOptionUid}
                        onUpdateOption={props.onUpdateOption}
                        onAddOption={() => props.onAddOption(line.uid)}
                        onRemoveOption={props.onRemoveOption}
                        onJumpToLine={props.onJumpToLine}
                      />
                    </Field>
                  )}
  
                  {line.kind === '指令' && line.jumpGroupUid !== null && (
                    <Field label="跳转到段落" className="line-field-command">
                      <span className="jump-group">
                        <select
                          value={line.jumpGroupUid}
                          title="跳转到本章的哪个段落：导出成「剧情.播放对话# 该段落第一句的对话ID」"
                          onChange={(event) =>
                            props.onUpdateLine(line.uid, { jumpGroupUid: event.target.value })
                          }
                        >
                          <option value="">（选择段落）</option>
                          {props.groupChoices.map((choice) => (
                            <option key={choice.uid} value={choice.uid}>
                              {choice.label}
                            </option>
                          ))}
                          {/* 段落被删掉后留下的悬空引用也要显示出来，好让人改回去 */}
                          {line.jumpGroupUid !== '' &&
                            !props.groupChoices.some(
                              (choice) => choice.uid === line.jumpGroupUid,
                            ) && <option value={line.jumpGroupUid}>（段落已不存在）</option>}
                        </select>
                        <span className="hint">
                          导出为「剧情.播放对话# 该段落第一句的对话ID」，段落重排后自动跟着走
                        </span>
                      </span>
                    </Field>
                  )}

                  {line.kind === '指令' && line.jumpGroupUid === null && (
                    <Field label="指令" className="line-field-command">
                      <CommandInput
                        value={line.command}
                        defs={props.commandDefs}
                        category="指令"
                        targets={props.commandTargets}
                        expressionsOf={(id) =>
                          props.characters.find((c) => c.id === id)?.expressions ?? []
                        }
                        actionsOf={(id) => props.characters.find((c) => c.id === id)?.actions ?? []}
                        onChange={(next) => props.onUpdateLine(line.uid, { command: next })}
                      />
                    </Field>
                  )}
  
                  <Field label="操作" className="line-field-actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="mini danger"
                        title="删除这一行"
                        onClick={() => props.onRemoveLine(line.uid)}
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        className={`mini note-button${hasNote ? ' has-note' : ''}`}
                        title={hasNote ? '修改备注' : '添加备注'}
                        data-note={hasNote ? line.note : undefined}
                        onClick={() => setNoteUid(noteUid === line.uid ? null : line.uid)}
                      >
                        备注
                      </button>
                    </div>
                  </Field>
                </div>
  
                {noteUid === line.uid && (
                  <div className="line-note">
                    <span className="line-field-name">备注（只给自己看，不导出）</span>
                    <textarea
                      rows={2}
                      autoFocus
                      value={line.note}
                      placeholder="例如：这句要等 BGM 淡出后再进"
                      onChange={(event) =>
                        props.onUpdateLine(line.uid, { note: event.target.value })
                      }
                    />
                  </div>
                )}
            </article>
          </div>
        );
      })}

      {group.lines.length === 0 && (
        <div className="line-empty">
          这一段还没有内容。从左侧「脚本块」里拖一个「对话」「选项」或「指令」到这里。
        </div>
      )}

      {/* 末尾的追加区：拖到空白处就等于加到最后 */}
      <div
        className={`line-tail${dropAt === group.lines.length ? ' drop-tail' : ''}`}
        title="拖到这里追加到末尾"
      />
    </div>
  );
}
