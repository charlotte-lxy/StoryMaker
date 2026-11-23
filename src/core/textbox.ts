import { newUid } from './ids';
import type { AnchorCell, Rect, TextBoxRow } from './types';

/** 排版用的设计稿尺寸：界面缩放时整块画布按比例缩，位置和尺寸都按这个尺寸算 */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/** 新建文本框的默认位置：贴在画面下方、横向占满 */
export const DEFAULT_TEXT_BOX_RECT: Rect = { x: 0.05, y: 0.66, w: 0.9, h: 0.28 };

/** 文本框里名字 / 台词相对外框的默认位置（新建时换算成画布坐标） */
const DEFAULT_NAME_RECT: Rect = { x: 0.02, y: 0.04, w: 0.96, h: 0.2 };
const DEFAULT_TEXT_RECT: Rect = { x: 0.02, y: 0.28, w: 0.96, h: 0.68 };

/** 拖动缩放时框的最小边长（相对画面） */
export const MIN_RECT_SIDE = 0.02;
/** 允许控件拖到画布外面，但别拖到天边：左上角夹在这个范围内（相对画面） */
export const MIN_RECT_OFFSET = -1;
export const MAX_RECT_OFFSET = 2;
/** 宽高最大给到两倍画面，够做整屏背景和出血 */
export const MAX_RECT_SIDE = 2;

export const DEFAULT_ANCHOR: AnchorCell = { col: 0, row: 0 };

export const TEXT_BOX_ALIGNS = ['left', 'center', 'right'] as const;

export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 3;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把相对外框的矩形换算成画布坐标（老项目迁移用） */
export function composeRect(box: Rect, inner: Rect): Rect {
  return {
    x: box.x + inner.x * box.w,
    y: box.y + inner.y * box.h,
    w: inner.w * box.w,
    h: inner.h * box.h,
  };
}

/** 文本框 ID 的前缀：导出的行名，角色表「文本框」列也写它 */
export const TEXT_BOX_ID_PREFIX = 'TB_';

/** 生成一个还没被用掉的文本框 ID（TB_1、TB_2…） */
export function nextTextBoxId(rows: readonly { id: string }[]): string {
  const taken = new Set(rows.map((row) => row.id.trim()));
  let n = 1;
  while (taken.has(`${TEXT_BOX_ID_PREFIX}${n}`)) n += 1;
  return `${TEXT_BOX_ID_PREFIX}${n}`;
}

/** 新建一条文本框：位置是默认的，名字可以传（列表里显示用） */
export function createDefaultTextBox(name = '文本框 1', id = 'TB_1'): TextBoxRow {
  const box = { ...DEFAULT_TEXT_BOX_RECT };
  return {
    uid: newUid(),
    id,
    name,
    imageUid: '',
    showName: true,
    sampleName: '角色名',
    sampleText: '这是一段示例台词。',
    rectSpace: 'canvas',
    box,
    nameRect: composeRect(box, DEFAULT_NAME_RECT),
    textRect: composeRect(box, DEFAULT_TEXT_RECT),
    anchors: {
      bg: { ...DEFAULT_ANCHOR },
      name: { ...DEFAULT_ANCHOR },
      text: { ...DEFAULT_ANCHOR },
    },
    align: 'left',
    lineHeight: 1.5,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 把一个矩形收进允许的范围（手改过的 JSON 可能越界）。
 * 宽高太小会让把手挤在一起，所以有一个最小边长；位置允许越出画布。
 */
export function clampRect(raw: unknown, fallback: Rect): Rect {
  const record = isRecord(raw) ? raw : {};
  const w = clamp(asNumber(record.w, fallback.w), MIN_RECT_SIDE, MAX_RECT_SIDE);
  const h = clamp(asNumber(record.h, fallback.h), MIN_RECT_SIDE, MAX_RECT_SIDE);
  const x = clamp(asNumber(record.x, fallback.x), MIN_RECT_OFFSET, MAX_RECT_OFFSET);
  const y = clamp(asNumber(record.y, fallback.y), MIN_RECT_OFFSET, MAX_RECT_OFFSET);
  return { x, y, w, h };
}

/** 锚点选择器的 3 列 / 3 行参考线在画面上的比例：左 / 中 / 右（上 / 中 / 下） */
export function anchorFraction(index: number): number {
  return index === 1 ? 0.5 : index === 2 ? 1 : 0;
}

export function isStretchX(anchor: AnchorCell): boolean {
  return anchor.col === 3;
}

export function isStretchY(anchor: AnchorCell): boolean {
  return anchor.row === 3;
}

/**
 * 右侧面板上的四个数字（设计稿像素）。
 *
 * 不拉伸的锚点：`posX` / `posY` 是控件左上角相对锚点的偏移，`sizeX` / `sizeY` 是尺寸；
 * 拉伸的锚点：`posX` / `posY` 是左边距 / 上边距，`right` / `bottom` 是右边距 / 下边距，
 * 尺寸由两边的边距算出来（跟 Unreal 的槽位一样）。
 */
export interface SlotValues {
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
  right: number;
  bottom: number;
}

/** 画布矩形 → 右侧面板数字 */
export function rectToSlot(rect: Rect, anchor: AnchorCell): SlotValues {
  const left = rect.x * CANVAS_WIDTH;
  const top = rect.y * CANVAS_HEIGHT;
  return {
    posX: isStretchX(anchor) ? left : left - anchorFraction(anchor.col) * CANVAS_WIDTH,
    posY: isStretchY(anchor) ? top : top - anchorFraction(anchor.row) * CANVAS_HEIGHT,
    sizeX: rect.w * CANVAS_WIDTH,
    sizeY: rect.h * CANVAS_HEIGHT,
    right: (1 - rect.x - rect.w) * CANVAS_WIDTH,
    bottom: (1 - rect.y - rect.h) * CANVAS_HEIGHT,
  };
}

/** 右侧面板数字 → 画布矩形（越界、反向都交给 clampRect 收） */
export function slotToRect(slot: SlotValues, anchor: AnchorCell, fallback: Rect): Rect {
  const stretchX = isStretchX(anchor);
  const stretchY = isStretchY(anchor);
  const x = stretchX
    ? slot.posX / CANVAS_WIDTH
    : anchorFraction(anchor.col) + slot.posX / CANVAS_WIDTH;
  const y = stretchY
    ? slot.posY / CANVAS_HEIGHT
    : anchorFraction(anchor.row) + slot.posY / CANVAS_HEIGHT;
  const w = stretchX
    ? 1 - slot.posX / CANVAS_WIDTH - slot.right / CANVAS_WIDTH
    : slot.sizeX / CANVAS_WIDTH;
  const h = stretchY
    ? 1 - slot.posY / CANVAS_HEIGHT - slot.bottom / CANVAS_HEIGHT
    : slot.sizeY / CANVAS_HEIGHT;
  return clampRect({ x, y, w, h }, fallback);
}

function readAnchorValue(value: unknown): 0 | 1 | 2 | 3 {
  const index = Math.round(asNumber(value, 0));
  return (index <= 0 ? 0 : index >= 3 ? 3 : index) as 0 | 1 | 2 | 3;
}

function readAnchor(raw: unknown): AnchorCell {
  const record = isRecord(raw) ? raw : {};
  return { col: readAnchorValue(record.col), row: readAnchorValue(record.row) };
}

function readTextBox(raw: Record<string, unknown>, index: number): TextBoxRow {
  const fallback = createDefaultTextBox(`文本框 ${index + 1}`);
  const align = raw.align === 'center' || raw.align === 'right' ? raw.align : 'left';
  const uid = typeof raw.uid === 'string' && raw.uid !== '' ? raw.uid : fallback.uid;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : fallback.name;
  const imageUid = typeof raw.imageUid === 'string' ? raw.imageUid : '';
  const sampleName = typeof raw.sampleName === 'string' ? raw.sampleName : fallback.sampleName;
  const sampleText = typeof raw.sampleText === 'string' ? raw.sampleText : fallback.sampleText;
  const box = clampRect(raw.box, fallback.box);
  const anchorsRaw = isRecord(raw.anchors) ? raw.anchors : {};

  // 老项目里名字 / 台词存的是「相对外框」，0.7.11 起改成相对画布
  const relative = raw.rectSpace !== 'canvas';
  const readPart = (value: unknown, inner: Rect, absolute: Rect): Rect => {
    if (!relative) return clampRect(value, absolute);
    return clampRect(composeRect(box, clampRect(value, inner)), absolute);
  };

  return {
    uid,
    id: typeof raw.id === 'string' ? raw.id.trim() : '',
    name,
    imageUid,
    showName: typeof raw.showName === 'boolean' ? raw.showName : true,
    sampleName,
    sampleText,
    rectSpace: 'canvas',
    box,
    nameRect: readPart(raw.nameRect, DEFAULT_NAME_RECT, fallback.nameRect),
    textRect: readPart(raw.textRect, DEFAULT_TEXT_RECT, fallback.textRect),
    anchors: {
      bg: readAnchor(anchorsRaw.bg),
      name: readAnchor(anchorsRaw.name),
      text: readAnchor(anchorsRaw.text),
    },
    align,
    lineHeight: clamp(
      asNumber(raw.lineHeight, fallback.lineHeight),
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
    ),
  };
}

/**
 * 读取项目里的文本框列表。
 *
 * 老项目根本没有这一栏（undefined）→ 补一条默认的，让「文本框」页一打开就有东西可编辑；
 * 项目里显式存了空数组 → 说明用户把文本框删光了，保持空的。
 */
export function normalizeTextBoxes(raw: unknown): TextBoxRow[] {
  if (!Array.isArray(raw)) return [createDefaultTextBox()];
  const rows = raw.filter(isRecord).map((row, index) => readTextBox(row, index));
  // 文本框 ID 是后加的：老项目里没有，按顺序补 TB_1、TB_2…
  for (const row of rows) {
    if (row.id !== '') continue;
    row.id = nextTextBoxId(rows);
  }
  return rows;
}
