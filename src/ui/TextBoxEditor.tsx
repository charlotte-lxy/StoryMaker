import { useEffect, useRef, useState } from 'react';

import type { HostApi } from '../core/host';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MIN_RECT_SIDE,
  isStretchX,
  isStretchY,
  rectToSlot,
  slotToRect,
  type SlotValues,
} from '../core/textbox';
import type { AnchorCell, Project, Rect, TextBoxRow } from '../core/types';
import {
  addTextBox,
  rememberTextBox,
  removeTextBox,
  setTextBoxAnchor,
  setTextBoxRect,
  textBoxesOf,
  updateTextBox,
  type TextBoxPart,
} from '../state/textbox-operations';
import { ConfirmDialog } from './ConfirmDialog';
import { imageAssetOf } from '../core/preview-assets';
import { useAssetUrl } from './PreviewPlayer';
import type { AssetLibrary } from './use-asset-library';

interface Props {
  project: Project;
  assets: { library: AssetLibrary; host: HostApi | undefined };
  onChange: (project: Project) => void;
}

/** 缩放的八个方向 */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  target: TextBoxPart;
  mode: 'move' | 'resize';
  dir: ResizeDir;
  startX: number;
  startY: number;
  start: Rect;
  /** 换算基准：画布在屏幕上的实际大小（整块画布等比缩放，三个控件共用） */
  baseW: number;
  baseH: number;
}

const HANDLES: ReadonlyArray<{ dir: ResizeDir; style: React.CSSProperties }> = [
  { dir: 'nw', style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' } },
  { dir: 'n', style: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' } },
  { dir: 'ne', style: { right: 0, top: 0, transform: 'translate(50%, -50%)' } },
  { dir: 'e', style: { right: 0, top: '50%', transform: 'translate(50%, -50%)' } },
  { dir: 'se', style: { right: 0, bottom: 0, transform: 'translate(50%, 50%)' } },
  { dir: 's', style: { left: '50%', bottom: 0, transform: 'translate(-50%, 50%)' } },
  { dir: 'sw', style: { left: 0, bottom: 0, transform: 'translate(-50%, 50%)' } },
  { dir: 'w', style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
];

const PARTS: ReadonlyArray<{ part: TextBoxPart; label: string }> = [
  { part: 'box', label: '背景图' },
  { part: 'nameRect', label: '说话人名字' },
  { part: 'textRect', label: '台词' },
];

const ANCHOR_LABELS: readonly string[] = [
  '左上',
  '顶部居中',
  '右上',
  '横向拉伸·顶部',
  '左侧居中',
  '居中',
  '右侧居中',
  '横向拉伸·居中',
  '左下',
  '底部居中',
  '右下',
  '横向拉伸·底部',
  '纵向拉伸·左侧',
  '纵向拉伸·居中',
  '纵向拉伸·右侧',
  '全拉伸',
];

function anchorIndex(anchor: AnchorCell): number {
  return anchor.row * 4 + anchor.col;
}

/** 锚点选择器格子里的小方块：拉伸的方向画成一条通到底的条 */
function anchorMarkStyle(col: number, row: number): React.CSSProperties {
  const style: React.CSSProperties = { position: 'absolute' };
  if (col === 3) {
    style.left = 0;
    style.right = 0;
  } else {
    style.width = '30%';
    style.left = col === 1 ? '35%' : col === 2 ? '70%' : 0;
  }
  if (row === 3) {
    style.top = 0;
    style.bottom = 0;
  } else {
    style.height = '30%';
    style.top = row === 1 ? '35%' : row === 2 ? '70%' : 0;
  }
  return style;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

function formatPx(value: number): string {
  return value.toFixed(1);
}

/** 右侧面板上的一个数字框：输入过程中不打断，失焦或回车才写回 */
function SlotField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => formatPx(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(formatPx(value));
  }, [value, editing]);

  const commit = (): void => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(formatPx(value));
  };

  return (
    <label className="textbox-number">
      <span>{label}</span>
      <input
        type="number"
        step={1}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

/**
 * 剧情里的「文本框」子模块。
 *
 * 中间是 16:9 画布（按 1920×1080 设计稿画，随窗口等比缩放）：
 * 背景图 / 说话人名字 / 台词是三个各自独立的控件，选中哪个才显示它的八向把手；
 * 控件能拖到画布外面，位置和尺寸也可以用锚点 + 数字精确调。
 * 右边是细节面板，改背景图 / 示例文本 / 对齐 / 行距。
 * 这里只负责「长什么样」，预览播放时用的是剧情里的真实台词。
 */
export function TextBoxEditor({ project, assets, onChange }: Props) {
  const boxes = textBoxesOf(project);
  const [selectedUid, setSelectedUid] = useState<string>(() => project.ui?.textBoxUid ?? '');
  const [part, setPart] = useState<TextBoxPart | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const active = boxes.find((row) => row.uid === selectedUid) ?? boxes[0];

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [scale, setScale] = useState(0.5);
  /** 连续 pointermove 时用最新一次的 project / active，避免基于旧状态计算 */
  const latestRef = useRef({ project, active });
  latestRef.current = { project, active };

  const image =
    active === undefined ? undefined : imageAssetOf(project, assets.library.byId, active.imageUid);
  const backgroundUrl = useAssetUrl(assets.host, image?.file);

  /** 画布占满中间一栏，但保持 16:9：取宽高两个方向缩得更小的那个 */
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const update = (): void => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 换一条文本框、或者名字被藏起来了，之前选中的控件就不成立了
  useEffect(() => {
    setPart(null);
  }, [active?.uid]);

  useEffect(() => {
    if (part === 'nameRect' && active?.showName === false) setPart(null);
  }, [part, active?.showName]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const { project: currentProject, active: current } = latestRef.current;
      if (current === undefined) return;

      const dx = (event.clientX - drag.startX) / drag.baseW;
      const dy = (event.clientY - drag.startY) / drag.baseH;
      let rect: Rect;

      if (drag.mode === 'move') {
        rect = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
      } else {
        const { x, y, w, h } = drag.start;
        let nextX = x;
        let nextY = y;
        let nextW = w;
        let nextH = h;
        if (drag.dir.includes('e')) nextW = Math.max(MIN_RECT_SIDE, w + dx);
        if (drag.dir.includes('s')) nextH = Math.max(MIN_RECT_SIDE, h + dy);
        if (drag.dir.includes('w')) {
          nextW = Math.max(MIN_RECT_SIDE, w - dx);
          nextX = x + w - nextW;
        }
        if (drag.dir.includes('n')) {
          nextH = Math.max(MIN_RECT_SIDE, h - dy);
          nextY = y + h - nextH;
        }
        rect = { x: nextX, y: nextY, w: nextW, h: nextH };
      }

      const updated = setTextBoxRect(currentProject, current.uid, drag.target, rect);
      latestRef.current.project = updated;
      onChange(updated);
    };

    const onUp = (): void => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onChange]);

  const beginDrag = (
    target: TextBoxPart,
    mode: 'move' | 'resize',
    dir: ResizeDir,
    event: React.PointerEvent,
  ): void => {
    if (active === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setPart(target);
    const rect = canvasRef.current?.getBoundingClientRect();
    dragRef.current = {
      target,
      mode,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...active[target] },
      baseW: rect?.width || CANVAS_WIDTH * scale,
      baseH: rect?.height || CANVAS_HEIGHT * scale,
    };
  };

  const patch = (changes: Partial<Omit<TextBoxRow, 'uid'>>): void => {
    if (active === undefined) return;
    onChange(updateTextBox(project, active.uid, changes));
  };

  const select = (uid: string): void => {
    setSelectedUid(uid);
    onChange(rememberTextBox(project, uid));
  };

  const handleAdd = (): void => {
    const next = addTextBox(project);
    const created = textBoxesOf(next).at(-1);
    if (created !== undefined) {
      setSelectedUid(created.uid);
      onChange(rememberTextBox(next, created.uid));
    } else {
      onChange(next);
    }
  };

  const handleRemove = (uid: string): void => {
    const next = removeTextBox(project, uid);
    setPendingRemove(null);
    const remaining = textBoxesOf(next);
    if (remaining.length > 0) {
      setSelectedUid(remaining[0].uid);
      onChange(rememberTextBox(next, remaining[0].uid));
    } else {
      setSelectedUid('');
      onChange(next);
    }
  };

  const layerClass = (target: TextBoxPart): string => {
    const base =
      target === 'box' ? 'textbox-frame' : target === 'nameRect' ? 'textbox-name' : 'textbox-text';
    return part === target ? `${base} selected` : base;
  };

  const layerStyle = (rect: Rect): React.CSSProperties => ({
    left: pct(rect.x),
    top: pct(rect.y),
    width: pct(rect.w),
    height: pct(rect.h),
  });

  const slotOf = (which: TextBoxPart): { rect: Rect; anchor: AnchorCell } | null => {
    if (active === undefined) return null;
    const anchor =
      which === 'box' ? active.anchors.bg : which === 'nameRect' ? active.anchors.name : active.anchors.text;
    return { rect: active[which], anchor };
  };

  const commitSlot = (which: TextBoxPart, key: keyof SlotValues, value: number): void => {
    const slot = slotOf(which);
    if (slot === null || active === undefined) return;
    const next = slotToRect({ ...rectToSlot(slot.rect, slot.anchor), [key]: value }, slot.anchor, slot.rect);
    onChange(setTextBoxRect(project, active.uid, which, next));
  };

  return (
    <div className="textbox-page">
      <div className="textbox-toolbar">
        <div className="textbox-tabs" role="tablist" aria-label="文本框列表">
          {boxes.map((row) => (
            <button
              key={row.uid}
              type="button"
              role="tab"
              aria-selected={row.uid === active?.uid}
              className={row.uid === active?.uid ? 'textbox-tab active' : 'textbox-tab'}
              onClick={() => select(row.uid)}
            >
              {row.name.trim() === '' ? '未命名文本框' : row.name}
            </button>
          ))}
        </div>
        <button type="button" className="textbox-add" onClick={handleAdd}>
          ＋ 新建文本框
        </button>
      </div>

      <div className="textbox-workspace">
        <div className="textbox-canvas-wrap">
          <div className="textbox-stage" ref={stageRef}>
            <div
              className="textbox-scaler"
              style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}
            >
              <div
                ref={canvasRef}
                className="textbox-canvas"
                style={{
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  transform: `scale(${scale})`,
                }}
                onPointerDown={() => setPart(null)}
              >
                {active === undefined ? (
                  <div className="textbox-empty">还没有文本框，点右上角「新建文本框」加一个。</div>
                ) : (
                  <>
                    <div
                      className={layerClass('box')}
                      style={layerStyle(active.box)}
                      onPointerDown={(event) => beginDrag('box', 'move', 'n', event)}
                    >
                      {backgroundUrl !== '' && (
                        <img className="textbox-bg" src={backgroundUrl} alt="" draggable={false} />
                      )}
                    </div>

                    {active.showName && (
                      <div
                        className={layerClass('nameRect')}
                        style={{ ...layerStyle(active.nameRect), textAlign: active.align }}
                        onPointerDown={(event) => beginDrag('nameRect', 'move', 'n', event)}
                      >
                        {active.sampleName.trim() === '' ? '角色名' : active.sampleName}
                      </div>
                    )}

                    <div
                      className={layerClass('textRect')}
                      style={{
                        ...layerStyle(active.textRect),
                        textAlign: active.align,
                        lineHeight: active.lineHeight,
                      }}
                      onPointerDown={(event) => beginDrag('textRect', 'move', 'n', event)}
                    >
                      {active.sampleText.trim() === '' ? '这是一段示例台词。' : active.sampleText}
                    </div>

                    {part !== null && (
                      <div className="textbox-handles" style={layerStyle(active[part])}>
                        {HANDLES.map((handle) => (
                          <div
                            key={handle.dir}
                            className={`textbox-handle resize-${handle.dir}`}
                            style={handle.style}
                            onPointerDown={(event) =>
                              beginDrag(part, 'resize', handle.dir, event)
                            }
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <p className="textbox-hint">
            画布按 1920×1080 的设计稿等比缩放。点中哪个控件才显示它的八向把手：拖框挪位置，拖四边或四角改大小；
            控件可以拖到画布外面，数字按像素算。
          </p>
        </div>

        {active !== undefined && (
          <aside className="textbox-detail">
            <h3>文本框设置</h3>

            <label className="field">
              <span>文本框 ID（导出行名，不可重复）</span>
              <input
                value={active.id}
                placeholder="TB_1"
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>

            <label className="field">
              <span>名称（只在列表里显示）</span>
              <input
                value={active.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>

            <label className="field">
              <span>背景图片</span>
              <select
                value={active.imageUid}
                onChange={(event) => patch({ imageUid: event.target.value })}
              >
                <option value="">（无，全透明）</option>
                {project.images.map((row) => (
                  <option key={row.uid} value={row.uid}>
                    {row.id.trim() === '' ? '（未填图片 ID）' : row.id}
                    {row.name.trim() === '' ? '' : ` · ${row.name}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="textbox-check">
              <input
                type="checkbox"
                checked={active.showName}
                onChange={(event) => patch({ showName: event.target.checked })}
              />
              显示说话人名字
            </label>

            <div className="textbox-section">
              <h4>控件位置</h4>
              <p className="textbox-section-hint">
                点画布上的控件，或点下面的按钮选中；选中后才显示八向把手。
              </p>
              <div className="textbox-parts">
                {PARTS.map((item) => (
                  <button
                    key={item.part}
                    type="button"
                    className={part === item.part ? 'active' : ''}
                    disabled={item.part === 'nameRect' && !active.showName}
                    onClick={() => setPart(item.part)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {part === null ? (
                <p className="textbox-section-hint">还没有选中控件。</p>
              ) : (
                (() => {
                  const slot = slotOf(part);
                  if (slot === null) return null;
                  const values = rectToSlot(slot.rect, slot.anchor);
                  const stretchX = isStretchX(slot.anchor);
                  const stretchY = isStretchY(slot.anchor);
                  return (
                    <>
                      <div className="textbox-anchor">
                        <span>锚点（{ANCHOR_LABELS[anchorIndex(slot.anchor)]}）</span>
                        <div className="textbox-anchor-grid" role="group" aria-label="锚点">
                          {ANCHOR_LABELS.map((label, index) => {
                            const col = index % 4;
                            const row = Math.floor(index / 4);
                            return (
                              <button
                                key={label}
                                type="button"
                                aria-label={`锚点：${label}`}
                                aria-pressed={slot.anchor.col === col && slot.anchor.row === row}
                                className={
                                  slot.anchor.col === col && slot.anchor.row === row ? 'active' : ''
                                }
                                onClick={() =>
                                  onChange(
                                    setTextBoxAnchor(project, active.uid, part, {
                                      col: col as AnchorCell['col'],
                                      row: row as AnchorCell['row'],
                                    }),
                                  )
                                }
                              >
                                <span
                                  className="textbox-anchor-mark"
                                  style={anchorMarkStyle(col, row)}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="textbox-slot">
                        <SlotField
                          key={`x-${part}`}
                          label={stretchX ? '左边距' : '位置X'}
                          value={values.posX}
                          onCommit={(value) => commitSlot(part, 'posX', value)}
                        />
                        {stretchX ? (
                          <SlotField
                            key={`right-${part}`}
                            label="右边距"
                            value={values.right}
                            onCommit={(value) => commitSlot(part, 'right', value)}
                          />
                        ) : (
                          <SlotField
                            key={`sx-${part}`}
                            label="尺寸X"
                            value={values.sizeX}
                            onCommit={(value) => commitSlot(part, 'sizeX', value)}
                          />
                        )}
                        <SlotField
                          key={`y-${part}`}
                          label={stretchY ? '上边距' : '位置Y'}
                          value={values.posY}
                          onCommit={(value) => commitSlot(part, 'posY', value)}
                        />
                        {stretchY ? (
                          <SlotField
                            key={`bottom-${part}`}
                            label="下边距"
                            value={values.bottom}
                            onCommit={(value) => commitSlot(part, 'bottom', value)}
                          />
                        ) : (
                          <SlotField
                            key={`sy-${part}`}
                            label="尺寸Y"
                            value={values.sizeY}
                            onCommit={(value) => commitSlot(part, 'sizeY', value)}
                          />
                        )}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            <label className="field">
              <span>示例名字</span>
              <input
                value={active.sampleName}
                onChange={(event) => patch({ sampleName: event.target.value })}
              />
            </label>

            <label className="field">
              <span>示例台词</span>
              <textarea
                rows={4}
                value={active.sampleText}
                onChange={(event) => patch({ sampleText: event.target.value })}
              />
            </label>

            <div className="field">
              <span>文本排列</span>
              <div className="textbox-aligns">
                {(
                  [
                    ['left', '左对齐'],
                    ['center', '居中'],
                    ['right', '右对齐'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={active.align === value ? 'active' : ''}
                    onClick={() => patch({ align: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>行距（{active.lineHeight.toFixed(1)}）</span>
              <input
                type="range"
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={0.1}
                value={active.lineHeight}
                onChange={(event) => patch({ lineHeight: Number(event.target.value) })}
              />
            </label>

            <button
              type="button"
              className="danger textbox-remove"
              onClick={() => setPendingRemove(active.uid)}
            >
              删除这个文本框
            </button>
          </aside>
        )}
      </div>

      {pendingRemove !== null && (
        <ConfirmDialog
          message="删除这个文本框？删掉之后还能再新建，但这一份的排版不会保留。"
          confirmLabel="删除"
          onConfirm={() => handleRemove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
