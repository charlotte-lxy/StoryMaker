import { useEffect, useRef, useState } from 'react';

import type { HostApi } from '../core/host';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MIN_RECT_SIDE,
  TEXT_BOX_FONTS,
  rectToSlot,
  slotToRect,
  type SlotValues,
} from '../core/textbox';
import type { AnchorCell, Project, Rect, TextBoxReveal, TextBoxRow } from '../core/types';
import {
  TEXT_BOX_PART_LABELS,
  TEXT_BOX_PARTS,
  addTextBox,
  rememberTextBox,
  removeTextBox,
  setTextBoxAnchor,
  setTextBoxControl,
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

/** 右侧面板上的一个数字框：输入过程中不打断，失焦或回车才写回 */
function SlotField({
  label,
  ariaLabel,
  value,
  step = 1,
  digits = 1,
  onCommit,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  step?: number;
  digits?: number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const format = (input: number): string => input.toFixed(digits);
  const [draft, setDraft] = useState(() => format(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(format(value));
  }, [value, editing]);

  const commit = (): void => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(format(value));
  };

  return (
    <label className="textbox-number">
      <span>{label}</span>
      <input
        type="number"
        aria-label={ariaLabel ?? label}
        step={step}
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

/** 控件自己的背景图（三个控件都能配），没选图就不画 */
function ControlImage({
  project,
  assets,
  imageUid,
}: {
  project: Project;
  assets: { library: AssetLibrary; host: HostApi | undefined };
  imageUid: string;
}): React.JSX.Element | null {
  const image = imageAssetOf(project, assets.library.byId, imageUid);
  const url = useAssetUrl(assets.host, image?.file);
  if (url === '') return null;
  return <img className="textbox-bg" src={url} alt="" draggable={false} />;
}

/** 文字控件的字体样式：颜色、字号、字体、对齐、行距（背景图没有文字，就不显示） */
function TextStyleFields({
  control,
  onChange,
}: {
  control: TextBoxRow['text'];
  onChange: (patch: Partial<TextBoxRow['text']>) => void;
}): React.JSX.Element {
  return (
    <>
      <label className="field">
        <span>字体大小（设计稿像素）</span>
        <input
          type="number"
          step={1}
          value={control.fontSize}
          onChange={(event) => {
            const value = Number.parseFloat(event.target.value);
            if (!Number.isFinite(value)) return;
            onChange({ fontSize: value });
          }}
        />
      </label>

      <label className="field">
        <span>字体样式</span>
        <select
          value={control.fontFamily}
          onChange={(event) => onChange({ fontFamily: event.target.value })}
        >
          <option value="">（默认）</option>
          {TEXT_BOX_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
          {control.fontFamily !== '' && !TEXT_BOX_FONTS.includes(control.fontFamily as never) && (
            <option value={control.fontFamily}>{control.fontFamily}</option>
          )}
        </select>
      </label>

      <label className="field">
        <span>字体颜色</span>
        <input
          type="color"
          value={control.color}
          onChange={(event) => onChange({ color: event.target.value.toUpperCase() })}
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
              className={control.align === value ? 'active' : ''}
              onClick={() => onChange({ align: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>行距（{control.lineHeight.toFixed(1)}）</span>
        <input
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.1}
          value={control.lineHeight}
          onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}
        />
      </label>
    </>
  );
}

/**
 * 台词的出现效果：立即 / 淡入淡出 / 逐字，外加「允许多行」。
 *
 * 只有台词用得上这些：名字和背景图不会有逐字 / 淡入淡出的变化。
 */
function RevealFields({
  control,
  onChange,
}: {
  control: TextBoxRow['text'];
  onChange: (patch: Partial<TextBoxRow['text']>) => void;
}): React.JSX.Element {
  const number = (raw: string, fallback: number, min: number): number => {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
  };
  return (
    <>
      <label className="textbox-check">
        <input
          type="checkbox"
          checked={control.multiLine}
          onChange={(event) => onChange({ multiLine: event.target.checked })}
        />
        允许多行（下一句接在下一行）
      </label>

      <label className="field">
        <span>出现效果</span>
        <select
          value={control.reveal}
          onChange={(event) => onChange({ reveal: event.target.value as TextBoxReveal })}
        >
          <option value="instant">立即</option>
          <option value="fade">淡入淡出</option>
          <option value="typewriter">逐字</option>
        </select>
      </label>

      {control.reveal === 'fade' && (
        <>
          <label className="field">
            <span>淡入时长（秒）</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={control.fadeIn}
              onChange={(event) => onChange({ fadeIn: number(event.target.value, control.fadeIn, 0) })}
            />
          </label>
          <label className="field">
            <span>淡出时长（秒）</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={control.fadeOut}
              onChange={(event) => onChange({ fadeOut: number(event.target.value, control.fadeOut, 0) })}
            />
          </label>
        </>
      )}

      {control.reveal === 'typewriter' && (
        <>
          <label className="field">
            <span>速度（字/秒）</span>
            <input
              type="number"
              step={1}
              min={1}
              value={control.typeSpeed}
              onChange={(event) =>
                onChange({ typeSpeed: number(event.target.value, control.typeSpeed, 1) })
              }
            />
          </label>
          <label className="field">
            <span>标点停顿（秒）</span>
            <input
              type="number"
              step={0.05}
              min={0}
              value={control.punctuationPause}
              onChange={(event) =>
                onChange({ punctuationPause: number(event.target.value, control.punctuationPause, 0) })
              }
            />
          </label>
        </>
      )}
    </>
  );
}

/**
 * 剧情里的「文本框」子模块。
 *
 * 中间是 16:9 画布（按 1920×1080 设计稿画，随窗口等比缩放）：
 * 背景图 / 人物名称 / 台词是三个各自独立的控件，选中哪个才显示它的八向把手；
 * 控件能拖到画布外面，位置和尺寸也可以用锚点 + 数字精确调。
 * 右边是细节面板：「控件」三个选项卡，每个控件有自己的背景图、字体、颜色、
 * 示例文本、对齐与行距，也能单独隐藏。
 */
export function TextBoxEditor({ project, assets, onChange }: Props) {
  const boxes = textBoxesOf(project);
  const [selectedUid, setSelectedUid] = useState<string>(() => project.ui?.textBoxUid ?? '');
  const [part, setPart] = useState<TextBoxPart>('bg');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const active = boxes.find((row) => row.uid === selectedUid) ?? boxes[0];

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [scale, setScale] = useState(0.5);
  /** 连续 pointermove 时用最新一次的 project / active，避免基于旧状态计算 */
  const latestRef = useRef({ project, active });
  latestRef.current = { project, active };

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

  // 换一条文本框，控件选项卡回到背景图
  useEffect(() => {
    setPart('bg');
  }, [active?.uid]);

  useEffect(() => {
    if (active?.[part].hidden === true) return;
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
  }, [onChange, part, active?.[part].hidden]);

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
      start: { ...active[target].rect },
      baseW: rect?.width || CANVAS_WIDTH * scale,
      baseH: rect?.height || CANVAS_HEIGHT * scale,
    };
  };

  const patch = (changes: Partial<Omit<TextBoxRow, 'uid'>>): void => {
    if (active === undefined) return;
    onChange(updateTextBox(project, active.uid, changes));
  };

  const patchControl = (which: TextBoxPart, changes: Partial<TextBoxRow['text']>): void => {
    if (active === undefined) return;
    onChange(setTextBoxControl(project, active.uid, which, changes));
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

  const layerStyle = (rect: Rect): React.CSSProperties => ({
    left: pct(rect.x),
    top: pct(rect.y),
    width: pct(rect.w),
    height: pct(rect.h),
  });

  /** 文字控件的行内样式：字体、字号、颜色、对齐、行距 */
  const textStyle = (which: 'speaker' | 'text'): React.CSSProperties => {
    const item = active?.[which];
    if (item === undefined) return {};
    return {
      fontFamily: item.fontFamily === '' ? undefined : `"${item.fontFamily}", sans-serif`,
      fontSize: item.fontSize,
      color: item.color,
      textAlign: item.align,
      lineHeight: item.lineHeight,
    };
  };

  const slotOf = (
    which: TextBoxPart,
  ): { rect: Rect; anchor: AnchorCell; pivotX: number; pivotY: number } | null => {
    if (active === undefined) return null;
    const control = active[which];
    return { rect: control.rect, anchor: control.anchor, pivotX: control.pivotX, pivotY: control.pivotY };
  };

  const commitSlot = (which: TextBoxPart, key: keyof SlotValues, value: number): void => {
    const slot = slotOf(which);
    if (slot === null || active === undefined) return;
    const next = slotToRect(
      { ...rectToSlot(slot.rect, slot.anchor, slot.pivotX, slot.pivotY), [key]: value },
      slot.anchor,
      slot.rect,
      slot.pivotX,
      slot.pivotY,
    );
    onChange(setTextBoxRect(project, active.uid, which, next));
  };

  const layerClass = (target: TextBoxPart): string => {
    const base =
      target === 'bg' ? 'textbox-frame' : target === 'speaker' ? 'textbox-name' : 'textbox-text';
    return part === target ? `${base} selected` : base;
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
              >
                {active === undefined ? (
                  <div className="textbox-empty">还没有文本框，点右上角「新建文本框」加一个。</div>
                ) : (
                  <>
                    {!active.bg.hidden && (
                      <div
                        className={layerClass('bg')}
                        style={layerStyle(active.bg.rect)}
                        onPointerDown={(event) => beginDrag('bg', 'move', 'n', event)}
                      >
                        <ControlImage project={project} assets={assets} imageUid={active.bg.imageUid} />
                      </div>
                    )}

                    {!active.speaker.hidden && (
                      <div
                        className={layerClass('speaker')}
                        style={{ ...layerStyle(active.speaker.rect), ...textStyle('speaker') }}
                        onPointerDown={(event) => beginDrag('speaker', 'move', 'n', event)}
                      >
                        <ControlImage
                          project={project}
                          assets={assets}
                          imageUid={active.speaker.imageUid}
                        />
                        <span>{active.speaker.sampleText.trim() === '' ? '角色名' : active.speaker.sampleText}</span>
                      </div>
                    )}

                    {!active.text.hidden && (
                      <div
                        className={layerClass('text')}
                        style={{ ...layerStyle(active.text.rect), ...textStyle('text') }}
                        onPointerDown={(event) => beginDrag('text', 'move', 'n', event)}
                      >
                        <ControlImage project={project} assets={assets} imageUid={active.text.imageUid} />
                        <span>
                          {active.text.sampleText.trim() === ''
                            ? '这是一段示例台词。'
                            : active.text.sampleText}
                        </span>
                      </div>
                    )}

                    {!active[part].hidden && (
                      <div className="textbox-handles" style={layerStyle(active[part].rect)}>
                        {HANDLES.map((handle) => (
                          <div
                            key={handle.dir}
                            className={`textbox-handle resize-${handle.dir}`}
                            style={handle.style}
                            onPointerDown={(event) => beginDrag(part, 'resize', handle.dir, event)}
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
              <span>层级（大的显示在上层）</span>
              <input
                type="number"
                step={1}
                value={active.layer}
                onChange={(event) => {
                  const value = Number.parseFloat(event.target.value);
                  if (!Number.isFinite(value)) return;
                  patch({ layer: Math.round(value) });
                }}
              />
            </label>

            <div className="textbox-section">
              <h4>控件</h4>
              <p className="textbox-section-hint">
                三个控件各自摆位、各自配属性；勾上「隐藏控件」后画布和预览里都不显示。
              </p>
              <div className="textbox-parts" role="tablist" aria-label="控件">
                {TEXT_BOX_PARTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={part === item}
                    className={part === item ? 'active' : ''}
                    onClick={() => setPart(item)}
                  >
                    {TEXT_BOX_PART_LABELS[item]}
                  </button>
                ))}
              </div>

              <label className="textbox-check">
                <input
                  type="checkbox"
                  checked={active[part].hidden}
                  onChange={(event) => patchControl(part, { hidden: event.target.checked })}
                />
                隐藏控件
              </label>

              {(() => {
                const slot = slotOf(part);
                if (slot === null) return null;
                const values = rectToSlot(slot.rect, slot.anchor, slot.pivotX, slot.pivotY);
                const clampPivot = (value: number): number => Math.min(1, Math.max(0, value));
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
                      <span className="textbox-slot-label">位置</span>
                      <SlotField
                        key={`px-${part}`}
                        label="X"
                        ariaLabel="位置X"
                        value={values.posX}
                        onCommit={(value) => commitSlot(part, 'posX', value)}
                      />
                      <SlotField
                        key={`py-${part}`}
                        label="Y"
                        ariaLabel="位置Y"
                        value={values.posY}
                        onCommit={(value) => commitSlot(part, 'posY', value)}
                      />
                    </div>

                    <div className="textbox-slot">
                      <span className="textbox-slot-label">尺寸</span>
                      <SlotField
                        key={`sx-${part}`}
                        label="X"
                        ariaLabel="尺寸X"
                        value={values.sizeX}
                        onCommit={(value) => commitSlot(part, 'sizeX', value)}
                      />
                      <SlotField
                        key={`sy-${part}`}
                        label="Y"
                        ariaLabel="尺寸Y"
                        value={values.sizeY}
                        onCommit={(value) => commitSlot(part, 'sizeY', value)}
                      />
                    </div>

                    <div className="textbox-slot">
                      <span className="textbox-slot-label">对齐</span>
                      <SlotField
                        key={`ax-${part}`}
                        label="X"
                        ariaLabel="对齐X"
                        step={0.1}
                        digits={2}
                        value={slot.pivotX}
                        onCommit={(value) => patchControl(part, { pivotX: clampPivot(value) })}
                      />
                      <SlotField
                        key={`ay-${part}`}
                        label="Y"
                        ariaLabel="对齐Y"
                        step={0.1}
                        digits={2}
                        value={slot.pivotY}
                        onCommit={(value) => patchControl(part, { pivotY: clampPivot(value) })}
                      />
                    </div>
                  </>
                );
              })()}

              <label className="field">
                <span>背景图片</span>
                <select
                  value={active[part].imageUid}
                  onChange={(event) => patchControl(part, { imageUid: event.target.value })}
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

              {part === 'speaker' && (
                <label className="field">
                  <span>示例文本</span>
                  <input
                    value={active.speaker.sampleText}
                    onChange={(event) => patchControl('speaker', { sampleText: event.target.value })}
                  />
                </label>
              )}

              {part === 'text' && (
                <label className="field">
                  <span>示例文本</span>
                  <textarea
                    rows={3}
                    value={active.text.sampleText}
                    onChange={(event) => patchControl('text', { sampleText: event.target.value })}
                  />
                </label>
              )}

              {part === 'text' && (
                <RevealFields
                  control={active.text}
                  onChange={(changes) => patchControl('text', changes)}
                />
              )}

              {part !== 'bg' && (
                <TextStyleFields control={active[part]} onChange={(changes) => patchControl(part, changes)} />
              )}
            </div>

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
