import { useEffect, useRef, useState } from 'react';

import type { HostApi } from '../core/host';
import { LINE_HEIGHT_MAX, LINE_HEIGHT_MIN, MIN_RECT_SIDE, clamp } from '../core/textbox';
import type { Project, Rect, TextBoxRow } from '../core/types';
import {
  addTextBox,
  rememberTextBox,
  removeTextBox,
  setTextBoxRect,
  textBoxesOf,
  updateTextBox,
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

/** 拖的是哪一块：外框 / 名字 / 台词 */
type DragTarget = 'box' | 'nameRect' | 'textRect';

/** 缩放的八个方向 */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  target: DragTarget;
  mode: 'move' | 'resize';
  dir: ResizeDir;
  startX: number;
  startY: number;
  start: Rect;
  /** 换算基准：外框拖移动用画面尺寸，名字 / 台词用外框尺寸 */
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

function pct(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

/**
 * 剧情里的「文本框」子模块。
 *
 * 左边（中间那块）是 16:9 画布：外框能拖、能八向缩放，名字和台词各自能拖。
 * 右边是细节面板，改背景图 / 示例文本 / 对齐 / 行距。
 * 这里只负责「长什么样」，预览播放时用的是剧情里的真实台词。
 */
export function TextBoxEditor({ project, assets, onChange }: Props) {
  const boxes = textBoxesOf(project);
  const [selectedUid, setSelectedUid] = useState<string>(() => project.ui?.textBoxUid ?? '');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const active = boxes.find((row) => row.uid === selectedUid) ?? boxes[0];

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** 连续 pointermove 时用最新一次的 project / active，避免基于旧状态计算 */
  const latestRef = useRef({ project, active });
  latestRef.current = { project, active };

  const image = active === undefined ? undefined : imageAssetOf(project, assets.library.byId, active.imageUid);
  const backgroundUrl = useAssetUrl(assets.host, image?.file);

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
        rect = {
          ...drag.start,
          x: clamp(drag.start.x + dx, 0, 1 - drag.start.w),
          y: clamp(drag.start.y + dy, 0, 1 - drag.start.h),
        };
      } else {
        const { x, y, w, h } = drag.start;
        let nextX = x;
        let nextY = y;
        let nextW = w;
        let nextH = h;
        if (drag.dir.includes('e')) nextW = clamp(w + dx, MIN_RECT_SIDE, 1 - x);
        if (drag.dir.includes('s')) nextH = clamp(h + dy, MIN_RECT_SIDE, 1 - y);
        if (drag.dir.includes('w')) {
          nextW = clamp(w - dx, MIN_RECT_SIDE, x + w);
          nextX = x + w - nextW;
        }
        if (drag.dir.includes('n')) {
          nextH = clamp(h - dy, MIN_RECT_SIDE, y + h);
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

  const baseSizeOf = (target: DragTarget): { baseW: number; baseH: number } => {
    const element = target === 'box' ? canvasRef.current : frameRef.current;
    const rect = element?.getBoundingClientRect();
    return { baseW: rect?.width ?? 1, baseH: rect?.height ?? 1 };
  };

  const beginDrag = (
    target: DragTarget,
    mode: 'move' | 'resize',
    dir: ResizeDir,
    event: React.PointerEvent,
  ): void => {
    if (active === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      target,
      mode,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...active[target] },
      ...baseSizeOf(target),
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
          <div className="textbox-canvas" ref={canvasRef}>
            {active === undefined ? (
              <div className="textbox-empty">还没有文本框，点右上角「新建文本框」加一个。</div>
            ) : (
              <div
                ref={frameRef}
                className="textbox-frame"
                style={{
                  left: pct(active.box.x),
                  top: pct(active.box.y),
                  width: pct(active.box.w),
                  height: pct(active.box.h),
                }}
                onPointerDown={(event) => beginDrag('box', 'move', 'n', event)}
              >
                {backgroundUrl !== '' && (
                  <img className="textbox-bg" src={backgroundUrl} alt="" draggable={false} />
                )}

                {active.showName && (
                  <div
                    className="textbox-name"
                    style={{
                      left: pct(active.nameRect.x),
                      top: pct(active.nameRect.y),
                      width: pct(active.nameRect.w),
                      height: pct(active.nameRect.h),
                      textAlign: active.align,
                    }}
                    onPointerDown={(event) => beginDrag('nameRect', 'move', 'n', event)}
                  >
                    {active.sampleName.trim() === '' ? '角色名' : active.sampleName}
                  </div>
                )}

                <div
                  className="textbox-text"
                  style={{
                    left: pct(active.textRect.x),
                    top: pct(active.textRect.y),
                    width: pct(active.textRect.w),
                    height: pct(active.textRect.h),
                    textAlign: active.align,
                    lineHeight: active.lineHeight,
                  }}
                  onPointerDown={(event) => beginDrag('textRect', 'move', 'n', event)}
                >
                  {active.sampleText.trim() === '' ? '这是一段示例台词。' : active.sampleText}
                </div>

                {HANDLES.map((handle) => (
                  <div
                    key={handle.dir}
                    className={`textbox-handle resize-${handle.dir}`}
                    style={handle.style}
                    onPointerDown={(event) => beginDrag('box', 'resize', handle.dir, event)}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="textbox-hint">
            拖动虚线外框可以挪位置，拖四边或四角可以改大小；名字和台词各自也能拖。
          </p>
        </div>

        {active !== undefined && (
          <aside className="textbox-detail">
            <h3>文本框设置</h3>

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
                <option value="">（无，半透明黑底）</option>
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
