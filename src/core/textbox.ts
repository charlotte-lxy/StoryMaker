import { newUid } from './ids';
import type { Rect, TextBoxRow } from './types';

/** 新建文本框的默认位置：贴在画面下方、横向占满 */
export const DEFAULT_TEXT_BOX_RECT: Rect = { x: 0.05, y: 0.66, w: 0.9, h: 0.28 };

/** 文本框里名字 / 台词相对外框的默认位置 */
const DEFAULT_NAME_RECT: Rect = { x: 0.02, y: 0.04, w: 0.96, h: 0.2 };
const DEFAULT_TEXT_RECT: Rect = { x: 0.02, y: 0.28, w: 0.96, h: 0.68 };

/** 拖动缩放时框的最小边长（相对画面） */
export const MIN_RECT_SIDE = 0.05;

export const TEXT_BOX_ALIGNS = ['left', 'center', 'right'] as const;

export const LINE_HEIGHT_MIN = 0.8;
export const LINE_HEIGHT_MAX = 3;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 新建一条文本框：位置是默认的，名字可以传（列表里显示用） */
export function createDefaultTextBox(name = '文本框 1'): TextBoxRow {
  return {
    uid: newUid(),
    name,
    imageUid: '',
    showName: true,
    sampleName: '角色名',
    sampleText: '这是一段示例台词。',
    box: { ...DEFAULT_TEXT_BOX_RECT },
    nameRect: { ...DEFAULT_NAME_RECT },
    textRect: { ...DEFAULT_TEXT_RECT },
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
 * 把一个矩形收进 0–1 的范围内（手改过的 JSON 可能越界）。
 * 宽高太小会让把手挤在一起，所以有一个最小边长。
 */
export function clampRect(raw: unknown, fallback: Rect): Rect {
  const record = isRecord(raw) ? raw : {};
  const w = clamp(asNumber(record.w, fallback.w), MIN_RECT_SIDE, 1);
  const h = clamp(asNumber(record.h, fallback.h), MIN_RECT_SIDE, 1);
  const x = clamp(asNumber(record.x, fallback.x), 0, 1 - w);
  const y = clamp(asNumber(record.y, fallback.y), 0, 1 - h);
  return { x, y, w, h };
}

function readTextBox(raw: Record<string, unknown>, index: number): TextBoxRow {
  const fallback = createDefaultTextBox(`文本框 ${index + 1}`);
  const align = raw.align === 'center' || raw.align === 'right' ? raw.align : 'left';
  const uid = typeof raw.uid === 'string' && raw.uid !== '' ? raw.uid : fallback.uid;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : fallback.name;
  const imageUid = typeof raw.imageUid === 'string' ? raw.imageUid : '';
  const sampleName = typeof raw.sampleName === 'string' ? raw.sampleName : fallback.sampleName;
  const sampleText = typeof raw.sampleText === 'string' ? raw.sampleText : fallback.sampleText;

  return {
    uid,
    name,
    imageUid,
    showName: typeof raw.showName === 'boolean' ? raw.showName : true,
    sampleName,
    sampleText,
    box: clampRect(raw.box, fallback.box),
    nameRect: clampRect(raw.nameRect, fallback.nameRect),
    textRect: clampRect(raw.textRect, fallback.textRect),
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
  return raw.filter(isRecord).map((row, index) => readTextBox(row, index));
}
