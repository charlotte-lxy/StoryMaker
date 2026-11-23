import { describe, expect, it } from 'vitest';

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_ANCHOR,
  DEFAULT_TEXT_BOX_RECT,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MAX_RECT_OFFSET,
  MIN_RECT_OFFSET,
  MIN_RECT_SIDE,
  clampRect,
  createDefaultTextBox,
  normalizeTextBoxes,
  rectToSlot,
  slotToRect,
} from './textbox';
import type { AnchorCell } from './types';

const CELL: AnchorCell = { col: 0, row: 0 };

describe('文本框的默认值与归一化', () => {
  it('新建的文本框贴在画面下方，字段齐全', () => {
    const row = createDefaultTextBox();
    expect(row.name).toBe('文本框 1');
    expect(row.box).toEqual(DEFAULT_TEXT_BOX_RECT);
    expect(row.showName).toBe(true);
    expect(row.sampleName).toBe('角色名');
    expect(row.sampleText).toBe('这是一段示例台词。');
    expect(row.align).toBe('left');
    expect(row.lineHeight).toBe(1.5);
    expect(row.imageUid).toBe('');
    expect(row.rectSpace).toBe('canvas');
    expect(row.anchors).toEqual({ bg: DEFAULT_ANCHOR, name: DEFAULT_ANCHOR, text: DEFAULT_ANCHOR });
    // 名字 / 台词都收在外框里面，但存的是画布坐标
    expect(row.nameRect.y).toBeGreaterThanOrEqual(row.box.y);
    expect(row.nameRect.y + row.nameRect.h).toBeLessThanOrEqual(row.box.y + row.box.h);
    expect(row.textRect.y).toBeGreaterThanOrEqual(row.box.y);
    expect(row.textRect.y + row.textRect.h).toBeLessThanOrEqual(row.box.y + row.box.h);
  });

  it('每个新建的文本框 uid 不一样', () => {
    expect(createDefaultTextBox().uid).not.toBe(createDefaultTextBox().uid);
  });

  it('clampRect 允许控件越出画布，但收在一个合理范围里', () => {
    const fallback = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(clampRect({ x: -5, y: 9, w: 0.5, h: 0.5 }, fallback)).toEqual({
      x: MIN_RECT_OFFSET,
      y: MAX_RECT_OFFSET,
      w: 0.5,
      h: 0.5,
    });
    expect(clampRect({ x: -0.5, y: 1.5, w: 0.5, h: 0.5 }, fallback)).toEqual({
      x: -0.5,
      y: 1.5,
      w: 0.5,
      h: 0.5,
    });
  });

  it('clampRect 保住最小边长，坏数据退回默认值', () => {
    const fallback = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(clampRect({ x: 0.1, y: 0.1, w: 0, h: 0 }, fallback).w).toBe(MIN_RECT_SIDE);
    expect(clampRect(null, fallback)).toEqual(fallback);
    expect(clampRect({ w: 'x' }, fallback)).toEqual(fallback);
  });

  it('没有这一栏时补一条默认的', () => {
    const rows = normalizeTextBoxes(undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('文本框 1');
  });

  it('显式存了空数组就保持空的', () => {
    expect(normalizeTextBoxes([])).toEqual([]);
  });

  it('缺字段的行会补齐，并按范围夹住', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        name: '旁白框',
        align: 'center',
        lineHeight: 99,
        box: { x: 0.9, y: 0.9, w: 0.4, h: 0.4 },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('tb1');
    expect(rows[0].name).toBe('旁白框');
    expect(rows[0].align).toBe('center');
    expect(rows[0].lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(rows[0].box).toEqual({ x: 0.9, y: 0.9, w: 0.4, h: 0.4 });
    expect(rows[0].showName).toBe(true);
    expect(rows[0].sampleName).toBe('角色名');
  });

  it('行距太小时夹到下限，非法对齐退回左对齐', () => {
    const rows = normalizeTextBoxes([{ uid: 'tb1', lineHeight: 0.1, align: 'middle' }]);
    expect(rows[0].lineHeight).toBe(LINE_HEIGHT_MIN);
    expect(rows[0].align).toBe('left');
  });

  it('不是对象的条目直接丢掉', () => {
    const rows = normalizeTextBoxes([null, 'x', 3, { uid: 'tb1' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe('tb1');
  });

  it('老项目里名字 / 台词相对外框，读进来换算成画布坐标', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
        nameRect: { x: 0, y: 0, w: 1, h: 1 },
        textRect: { x: 0.2, y: 0.1, w: 0.5, h: 0.25 },
      },
    ]);
    expect(rows[0].rectSpace).toBe('canvas');
    expect(rows[0].nameRect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(rows[0].textRect.x).toBeCloseTo(0.2);
    expect(rows[0].textRect.y).toBeCloseTo(0.24);
    expect(rows[0].textRect.w).toBeCloseTo(0.25);
    expect(rows[0].textRect.h).toBeCloseTo(0.1);
  });

  it('新格式的坐标与锚点原样读回', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        rectSpace: 'canvas',
        box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
        nameRect: { x: 0.2, y: 0.3, w: 0.4, h: 0.1 },
        textRect: { x: 0.2, y: 0.4, w: 0.4, h: 0.2 },
        anchors: { bg: { col: 3, row: 3 }, name: { col: 1, row: 2 }, text: { col: 9, row: -2 } },
      },
    ]);
    expect(rows[0].box).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(rows[0].nameRect).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.1 });
    expect(rows[0].anchors.bg).toEqual({ col: 3, row: 3 });
    expect(rows[0].anchors.name).toEqual({ col: 1, row: 2 });
    // 越界的锚点夹回 0–3
    expect(rows[0].anchors.text).toEqual({ col: 3, row: 0 });
  });
});

describe('锚点与像素数字的换算', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it('左上锚点：位置就是左上角像素，尺寸就是宽高像素', () => {
    const slot = rectToSlot(rect, CELL);
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT);
    expect(slot.sizeX).toBeCloseTo(0.3 * CANVAS_WIDTH);
    expect(slot.sizeY).toBeCloseTo(0.4 * CANVAS_HEIGHT);
  });

  it('居中锚点：位置是相对画面中心的偏移', () => {
    const slot = rectToSlot(rect, { col: 1, row: 1 });
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH - CANVAS_WIDTH / 2);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT - CANVAS_HEIGHT / 2);
  });

  it('非拉伸的槽位数字转回矩形是原样', () => {
    const anchor: AnchorCell = { col: 2, row: 1 };
    const next = slotToRect(rectToSlot(rect, anchor), anchor, rect);
    expect(next.x).toBeCloseTo(rect.x);
    expect(next.y).toBeCloseTo(rect.y);
    expect(next.w).toBeCloseTo(rect.w);
    expect(next.h).toBeCloseTo(rect.h);
  });

  it('拉伸锚点用边距算矩形，两个方向都拉伸时尺寸由边距推出来', () => {
    const anchor: AnchorCell = { col: 3, row: 3 };
    const next = slotToRect(
      {
        posX: 0.1 * CANVAS_WIDTH,
        posY: 0.2 * CANVAS_HEIGHT,
        sizeX: 0,
        sizeY: 0,
        right: 0.6 * CANVAS_WIDTH,
        bottom: 0.4 * CANVAS_HEIGHT,
      },
      anchor,
      rect,
    );
    expect(next.x).toBeCloseTo(0.1);
    expect(next.y).toBeCloseTo(0.2);
    expect(next.w).toBeCloseTo(0.3);
    expect(next.h).toBeCloseTo(0.4);
  });

  it('拉伸锚点下边距给反了，矩形退回最小边长而不是负宽', () => {
    const anchor: AnchorCell = { col: 3, row: 3 };
    const next = slotToRect(
      {
        posX: 0.6 * CANVAS_WIDTH,
        posY: 0.6 * CANVAS_HEIGHT,
        sizeX: 0,
        sizeY: 0,
        right: 0.6 * CANVAS_WIDTH,
        bottom: 0.6 * CANVAS_HEIGHT,
      },
      anchor,
      rect,
    );
    expect(next.w).toBe(MIN_RECT_SIDE);
    expect(next.h).toBe(MIN_RECT_SIDE);
  });
});
