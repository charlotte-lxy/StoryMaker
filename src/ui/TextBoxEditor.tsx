import { useEffect, useRef, useState } from 'react';

import type { HostApi } from '../core/host';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MIN_RECT_SIDE,
  TEXT_BOX_CONTENTS,
  TEXT_BOX_CONTENT_LABELS,
  TEXT_BOX_CONTROL_KINDS,
  TEXT_BOX_CONTROL_LABELS,
  TEXT_BOX_FONTS,
  TEXT_BOX_PORTRAIT_MODES,
  TEXT_BOX_PORTRAIT_MODE_LABELS,
  rectToSlot,
  slotToRect,
  type SlotValues,
} from '../core/textbox';
import type {
  AnchorCell,
  Project,
  Rect,
  TextBoxControl,
  TextBoxControlKind,
  TextBoxReveal,
  TextBoxRow,
} from '../core/types';
import {
  addControl,
  addTextBox,
  rememberTextBox,
  removeControl,
  removeTextBox,
  setControlAnchor,
  setControlProps,
  setControlRect,
  textBoxesOf,
  updateTextBox,
} from '../state/textbox-operations';
import { fontsOf } from '../state/font-operations';
import { ConfirmDialog } from './ConfirmDialog';
import { characterAssetOf, imageAssetOf } from '../core/preview-assets';
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
  mode: 'move' | 'resize';
  dir: ResizeDir;
  startX: number;
  startY: number;
  start: Rect;
  /** 换算基准：画布在屏幕上的实际大小（整块画布等比缩放） */
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

/** 控件自己的图片，没选图就不画 */
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

/** 立绘弹窗里的一行预览：按「角色 + 表情」找表情图片，找不到就画个占位 */
function PortraitPreview({
  project,
  assets,
  characterUid,
  expression,
}: {
  project: Project;
  assets: { library: AssetLibrary; host: HostApi | undefined };
  characterUid: string;
  expression: string;
}): React.JSX.Element {
  const character = project.characters.find((row) => row.uid === characterUid);
  const asset =
    character === undefined
      ? undefined
      : characterAssetOf(project, assets.library.byId, characterUid, expression);
  const url = useAssetUrl(assets.host, asset?.file);
  if (url !== '') return <img src={url} alt="" draggable={false} />;
  return (
    <div className="textbox-portrait-placeholder">
      <span>{character === undefined ? '（没选角色）' : character.id}</span>
      <span className="hint">{expression === '' ? '默认立绘' : expression}</span>
    </div>
  );
}

/** 文本控件的字体样式：颜色、字号、字体、对齐、行距 */
function TextStyleFields({
  control,
  fonts,
  onChange,
}: {
  control: TextBoxControl;
  /** 字体子模块里导入的字体显示名称（排在内置字体后面） */
  fonts: readonly string[];
  onChange: (patch: Partial<TextBoxControl>) => void;
}): React.JSX.Element {
  const builtin: string[] = [...TEXT_BOX_FONTS];
  const options: string[] = [...builtin, ...fonts.filter((font) => !builtin.includes(font))];
  const known = options.includes(control.fontFamily);
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
          {options.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
          {control.fontFamily !== '' && !known && (
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
 * 文本控件的出现效果：立即 / 淡入淡出 / 逐字，外加「允许多行」。
 *
 * 「允许多行」只对显示台词的文本控件有意义。
 */
function RevealFields({
  control,
  onChange,
}: {
  control: TextBoxControl;
  onChange: (patch: Partial<TextBoxControl>) => void;
}): React.JSX.Element {
  const number = (raw: string, fallback: number, min: number): number => {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
  };
  return (
    <>
      {control.content === 'line' && (
        <label className="textbox-check">
          <input
            type="checkbox"
            checked={control.multiLine}
            onChange={(event) => onChange({ multiLine: event.target.checked })}
          />
          允许多行（下一句接在下一行）
        </label>
      )}

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
 * 中间是 16:9 画布（按 1920×1080 设计稿画，随窗口等比缩放）。
 * 控件不再固定三个：图片 / 文本 / 立绘弹窗都能自己加，选中哪个才显示它的八向把手；
 * 控件能拖到画布外面，位置、尺寸、对齐也可以用锚点 + 数字精确调。
 */
export function TextBoxEditor({ project, assets, onChange }: Props) {
  const boxes = textBoxesOf(project);
  const [selectedUid, setSelectedUid] = useState<string>(() => project.ui?.textBoxUid ?? '');
  const [selectedControlUid, setSelectedControlUid] = useState<string>('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [pendingRemoveControl, setPendingRemoveControl] = useState<string | null>(null);

  const active = boxes.find((row) => row.uid === selectedUid) ?? boxes[0];
  const control =
    active?.controls.find((item) => item.uid === selectedControlUid) ?? active?.controls[0];
  /** 老项目里的立绘弹窗可能一行预览都没有，界面先给一行空的 */
  const portraitRows =
    control !== undefined && control.portraits.length > 0
      ? control.portraits
      : [{ characterUid: '', expression: '' }];
  /** 字体子模块里的显示名称，排在内置字体后面 */
  const fontNames = fontsOf(project).map((row) => row.name.trim()).filter((name) => name !== '');

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [scale, setScale] = useState(0.5);
  /** 连续 pointermove 时用最新一次的 project / 控件，避免基于旧状态计算 */
  const latestRef = useRef({ project, active, control });
  latestRef.current = { project, active, control };

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

  // 换一条文本框，选中的控件回到第一个
  useEffect(() => {
    setSelectedControlUid(active?.controls[0]?.uid ?? '');
  }, [active?.uid]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const { project: currentProject, active: currentBox, control: currentControl } =
        latestRef.current;
      if (currentBox === undefined || currentControl === undefined) return;

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

      const updated = setControlRect(
        currentProject,
        currentBox.uid,
        currentControl.uid,
        rect,
      );
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
    target: TextBoxControl,
    mode: 'move' | 'resize',
    dir: ResizeDir,
    event: React.PointerEvent,
  ): void => {
    if (active === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedControlUid(target.uid);
    const rect = canvasRef.current?.getBoundingClientRect();
    dragRef.current = {
      mode,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...target.rect },
      baseW: rect?.width || CANVAS_WIDTH * scale,
      baseH: rect?.height || CANVAS_HEIGHT * scale,
    };
  };

  const patch = (changes: Partial<Omit<TextBoxRow, 'uid'>>): void => {
    if (active === undefined) return;
    onChange(updateTextBox(project, active.uid, changes));
  };

  const patchControl = (changes: Partial<TextBoxControl>): void => {
    if (active === undefined || control === undefined) return;
    onChange(setControlProps(project, active.uid, control.uid, changes));
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
      setSelectedControlUid(created.controls[0]?.uid ?? '');
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
      setSelectedControlUid(remaining[0].controls[0]?.uid ?? '');
      onChange(rememberTextBox(next, remaining[0].uid));
    } else {
      setSelectedUid('');
      setSelectedControlUid('');
      onChange(next);
    }
  };

  const handleAddControl = (kind: TextBoxControlKind): void => {
    if (active === undefined) return;
    const next = addControl(project, active.uid, kind);
    const added = textBoxesOf(next)
      .find((row) => row.uid === active.uid)
      ?.controls.at(-1);
    if (added !== undefined) setSelectedControlUid(added.uid);
    onChange(next);
  };

  const handleRemoveControl = (controlUid: string): void => {
    if (active === undefined) return;
    const next = removeControl(project, active.uid, controlUid);
    setPendingRemoveControl(null);
    const remaining = textBoxesOf(next).find((row) => row.uid === active.uid)?.controls ?? [];
    setSelectedControlUid(remaining[0]?.uid ?? '');
    onChange(next);
  };

  const layerStyle = (rect: Rect): React.CSSProperties => ({
    left: pct(rect.x),
    top: pct(rect.y),
    width: pct(rect.w),
    height: pct(rect.h),
  });

  /** 文字控件的行内样式：字体、字号、颜色、对齐、行距 */
  const textStyle = (item: TextBoxControl): React.CSSProperties => ({
    fontFamily: item.fontFamily === '' ? undefined : `"${item.fontFamily}", sans-serif`,
    fontSize: item.fontSize,
    color: item.color,
    textAlign: item.align,
    lineHeight: item.lineHeight,
  });

  const commitSlot = (key: keyof SlotValues, value: number): void => {
    if (active === undefined || control === undefined) return;
    const slot = rectToSlot(control.rect, control.anchor, control.pivotX, control.pivotY);
    const next = slotToRect(
      { ...slot, [key]: value },
      control.anchor,
      control.rect,
      control.pivotX,
      control.pivotY,
    );
    onChange(setControlRect(project, active.uid, control.uid, next));
  };

  const layerClass = (item: TextBoxControl): string => {
    const base =
      item.kind === 'image' ? 'textbox-frame' : item.kind === 'portrait' ? 'textbox-portrait' : 'textbox-text';
    return control?.uid === item.uid ? `${base} selected` : base;
  };

  const values =
    control === undefined
      ? null
      : rectToSlot(control.rect, control.anchor, control.pivotX, control.pivotY);

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

      <div className="textbox-toolbar textbox-controls-bar">
        <span className="textbox-controls-label">添加控件</span>
        {TEXT_BOX_CONTROL_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="textbox-add"
            disabled={active === undefined}
            onClick={() => handleAddControl(kind)}
          >
            ＋ {TEXT_BOX_CONTROL_LABELS[kind]}
          </button>
        ))}
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
                    {active.controls.map((item) => {
                      if (item.kind === 'image') {
                        return (
                          <div
                            key={item.uid}
                            className={layerClass(item)}
                            style={layerStyle(item.rect)}
                            onPointerDown={(event) => beginDrag(item, 'move', 'n', event)}
                          >
                            <ControlImage
                              project={project}
                              assets={assets}
                              imageUid={item.imageUid}
                            />
                          </div>
                        );
                      }
                      if (item.kind === 'portrait') {
                        const rows =
                          item.portraits.length > 0
                            ? item.portraits
                            : [{ characterUid: '', expression: '' }];
                        const shown = item.portraitMode === 'single' ? rows.slice(0, 1) : rows;
                        return (
                          <div
                            key={item.uid}
                            className={layerClass(item)}
                            style={layerStyle(item.rect)}
                            onPointerDown={(event) => beginDrag(item, 'move', 'n', event)}
                          >
                            <div className="textbox-portrait-row" data-mode={item.portraitMode}>
                              {shown.map((row, index) => (
                                <PortraitPreview
                                  key={`${row.characterUid}-${index}`}
                                  project={project}
                                  assets={assets}
                                  characterUid={row.characterUid}
                                  expression={row.expression}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      }
                      const sample =
                        item.sampleText.trim() === ''
                          ? item.content === 'speaker'
                            ? '角色名'
                            : '这是一段示例台词。'
                          : item.sampleText;
                      return (
                        <div
                          key={item.uid}
                          className={layerClass(item)}
                          data-content={item.content}
                          style={{ ...layerStyle(item.rect), ...textStyle(item) }}
                          onPointerDown={(event) => beginDrag(item, 'move', 'n', event)}
                        >
                          <span>{sample}</span>
                        </div>
                      );
                    })}

                    {control !== undefined && (
                      <div className="textbox-handles" style={layerStyle(control.rect)}>
                        {HANDLES.map((handle) => (
                          <div
                            key={handle.dir}
                            className={`textbox-handle resize-${handle.dir}`}
                            style={handle.style}
                            onPointerDown={(event) => beginDrag(control, 'resize', handle.dir, event)}
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
                控件按列表顺序叠放，靠后的画在上层；点哪个就改哪个的属性。
              </p>
              <div className="textbox-parts" role="tablist" aria-label="控件">
                {active.controls.map((item) => (
                  <button
                    key={item.uid}
                    type="button"
                    role="tab"
                    aria-selected={control?.uid === item.uid}
                    className={control?.uid === item.uid ? 'active' : ''}
                    onClick={() => setSelectedControlUid(item.uid)}
                  >
                    {item.name.trim() === '' ? TEXT_BOX_CONTROL_LABELS[item.kind] : item.name}
                  </button>
                ))}
              </div>

              {control === undefined ? (
                <p className="textbox-section-hint">这个文本框还没有控件，用上面的「添加控件」加一个。</p>
              ) : (
                <>
                  <label className="field">
                    <span>控件名（只在编辑界面显示）</span>
                    <input
                      value={control.name}
                      onChange={(event) => patchControl({ name: event.target.value })}
                    />
                  </label>

                  <div className="textbox-anchor">
                    <span>锚点（{ANCHOR_LABELS[anchorIndex(control.anchor)]}）</span>
                    <div className="textbox-anchor-grid" role="group" aria-label="锚点">
                      {ANCHOR_LABELS.map((label, index) => {
                        const col = index % 4;
                        const row = Math.floor(index / 4);
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-label={`锚点：${label}`}
                            aria-pressed={control.anchor.col === col && control.anchor.row === row}
                            className={
                              control.anchor.col === col && control.anchor.row === row ? 'active' : ''
                            }
                            onClick={() =>
                              onChange(
                                setControlAnchor(project, active.uid, control.uid, {
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

                  {values !== null && (
                    <>
                      <div className="textbox-slot">
                        <span className="textbox-slot-label">位置</span>
                        <SlotField
                          key={`px-${control.uid}`}
                          label="X"
                          ariaLabel="位置X"
                          value={values.posX}
                          onCommit={(value) => commitSlot('posX', value)}
                        />
                        <SlotField
                          key={`py-${control.uid}`}
                          label="Y"
                          ariaLabel="位置Y"
                          value={values.posY}
                          onCommit={(value) => commitSlot('posY', value)}
                        />
                      </div>

                      <div className="textbox-slot">
                        <span className="textbox-slot-label">尺寸</span>
                        <SlotField
                          key={`sx-${control.uid}`}
                          label="X"
                          ariaLabel="尺寸X"
                          value={values.sizeX}
                          onCommit={(value) => commitSlot('sizeX', value)}
                        />
                        <SlotField
                          key={`sy-${control.uid}`}
                          label="Y"
                          ariaLabel="尺寸Y"
                          value={values.sizeY}
                          onCommit={(value) => commitSlot('sizeY', value)}
                        />
                      </div>

                      <div className="textbox-slot">
                        <span className="textbox-slot-label">对齐</span>
                        <SlotField
                          key={`ax-${control.uid}`}
                          label="X"
                          ariaLabel="对齐X"
                          step={0.1}
                          digits={2}
                          value={control.pivotX}
                          onCommit={(value) =>
                            patchControl({ pivotX: Math.min(1, Math.max(0, value)) })
                          }
                        />
                        <SlotField
                          key={`ay-${control.uid}`}
                          label="Y"
                          ariaLabel="对齐Y"
                          step={0.1}
                          digits={2}
                          value={control.pivotY}
                          onCommit={(value) =>
                            patchControl({ pivotY: Math.min(1, Math.max(0, value)) })
                          }
                        />
                      </div>
                    </>
                  )}

                  {control.kind === 'image' && (
                    <label className="field">
                      <span>图片</span>
                      <select
                        value={control.imageUid}
                        onChange={(event) => patchControl({ imageUid: event.target.value })}
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
                  )}

                  {control.kind === 'text' && (
                    <>
                      <label className="field">
                        <span>内容</span>
                        <select
                          value={control.content}
                          onChange={(event) =>
                            patchControl({
                              content: event.target.value as TextBoxControl['content'],
                            })
                          }
                        >
                          {TEXT_BOX_CONTENTS.map((value) => (
                            <option key={value} value={value}>
                              {TEXT_BOX_CONTENT_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </label>

                      {control.content === 'speaker' ? (
                        <label className="field">
                          <span>示例文本</span>
                          <input
                            value={control.sampleText}
                            onChange={(event) => patchControl({ sampleText: event.target.value })}
                          />
                        </label>
                      ) : (
                        <label className="field">
                          <span>示例文本</span>
                          <textarea
                            rows={3}
                            value={control.sampleText}
                            onChange={(event) => patchControl({ sampleText: event.target.value })}
                          />
                        </label>
                      )}

                      <RevealFields control={control} onChange={patchControl} />
                      <TextStyleFields control={control} fonts={fontNames} onChange={patchControl} />
                    </>
                  )}

                  {control.kind === 'portrait' && (
                    <>
                      <label className="field">
                        <span>显示方式</span>                        <select
                          value={control.portraitMode}
                          onChange={(event) =>
                            patchControl({
                              portraitMode: event.target.value as TextBoxControl['portraitMode'],
                            })
                          }
                        >
                          {TEXT_BOX_PORTRAIT_MODES.map((value) => (
                            <option key={value} value={value}>
                              {TEXT_BOX_PORTRAIT_MODE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="textbox-section">
                        <h4>预览角色</h4>
                        <p className="textbox-section-hint">
                          只影响编辑时的画面，不导出。单张只显示第一行，多张按顺序排开。
                        </p>
                        {(control.portraitMode === 'single'
                          ? portraitRows.slice(0, 1)
                          : portraitRows
                        ).map((row, index) => {
                          const character = project.characters.find(
                            (item) => item.uid === row.characterUid,
                          );
                          return (
                            <div className="textbox-portrait-row-fields" key={index}>
                              <label className="textbox-number">
                                <span>角色</span>
                                <select
                                  aria-label={`预览角色 ${index + 1}`}
                                  value={row.characterUid}
                                  onChange={(event) => {
                                    const next = portraitRows.map((item, i) =>
                                      i === index ? { ...item, characterUid: event.target.value } : item,
                                    );
                                    patchControl({ portraits: next });
                                  }}
                                >
                                  <option value="">（未选角色）</option>
                                  {project.characters.map((item) => (
                                    <option key={item.uid} value={item.uid}>
                                      {item.id}
                                      {item.name.trim() === '' ? '' : ` · ${item.name}`}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="textbox-number">
                                <span>表情</span>
                                <select
                                  aria-label={`预览表情 ${index + 1}`}
                                  value={row.expression}
                                  onChange={(event) => {
                                    const next = portraitRows.map((item, i) =>
                                      i === index ? { ...item, expression: event.target.value } : item,
                                    );
                                    patchControl({ portraits: next });
                                  }}
                                >
                                  <option value="">（默认）</option>
                                  {(character?.expressions ?? []).map((expression) => (
                                    <option key={expression} value={expression}>
                                      {expression}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          );
                        })}
                        {control.portraitMode === 'multi' && (
                          <button
                            type="button"
                            className="textbox-add"
                            onClick={() =>
                              patchControl({
                                portraits: [...portraitRows, { characterUid: '', expression: '' }],
                              })
                            }
                          >
                            ＋ 加一行预览
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  <button
                    type="button"
                    className="danger textbox-remove"
                    onClick={() => setPendingRemoveControl(control.uid)}
                  >
                    删除这个控件
                  </button>
                </>
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

      {pendingRemoveControl !== null && (
        <ConfirmDialog
          message="删除这个控件？删掉之后控件就没了，得重新加。"
          confirmLabel="删除"
          onConfirm={() => handleRemoveControl(pendingRemoveControl)}
          onCancel={() => setPendingRemoveControl(null)}
        />
      )}
    </div>
  );
}
