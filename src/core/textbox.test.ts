import { describe, expect, it } from 'vitest';

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_ANCHOR,
  DEFAULT_TEXT_BOX_RECT,
  FADE_MAX,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MAX_RECT_OFFSET,
  MIN_RECT_OFFSET,
  MIN_RECT_SIDE,
  TYPE_SPEED_MAX,
  clampRect,
  createDefaultTextBox,
  normalizeTextBoxes,
  rectToSlot,
  slotToRect,
} from './textbox';
import type { AnchorCell } from './types';

const CELL: AnchorCell = { col: 0, row: 0 };

describe('文本框的默认值与归一化', () => {
  it('新建的文本框贴在画面下方，三个控件字段齐全', () => {
    const row = createDefaultTextBox();
    expect(row.name).toBe('文本框 1');
    expect(row.bg.rect).toEqual(DEFAULT_TEXT_BOX_RECT);
    expect(row.bg.anchor).toEqual(DEFAULT_ANCHOR);
    expect(row.bg.hidden).toBe(false);
    expect(row.bg.imageUid).toBe('');
    expect(row.speaker.sampleText).toBe('角色名');
    expect(row.speaker.fontFamily).toBe('微软雅黑');
    expect(row.speaker.fontSize).toBe(40);
    expect(row.speaker.color).toBe('#FFFFFF');
    expect(row.text.sampleText).toBe('这是一段示例台词。');
    expect(row.text.fontSize).toBe(42);
    expect(row.text.align).toBe('left');
    expect(row.text.lineHeight).toBe(1.5);
    expect(row.text.reveal).toBe('instant');
    expect(row.text.multiLine).toBe(false);
    expect(row.layer).toBe(0);
    expect(row.rectSpace).toBe('canvas');
    // 名字 / 台词都收在外框里面，但存的是画布坐标
    expect(row.speaker.rect.y).toBeGreaterThanOrEqual(row.bg.rect.y);
    expect(row.speaker.rect.y + row.speaker.rect.h).toBeLessThanOrEqual(
      row.bg.rect.y + row.bg.rect.h,
    );
    expect(row.text.rect.y).toBeGreaterThanOrEqual(row.bg.rect.y);
    expect(row.text.rect.y + row.text.rect.h).toBeLessThanOrEqual(row.bg.rect.y + row.bg.rect.h);
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
    expect(rows[0].text.align).toBe('center');
    expect(rows[0].text.lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(rows[0].bg.rect).toEqual({ x: 0.9, y: 0.9, w: 0.4, h: 0.4 });
    expect(rows[0].speaker.hidden).toBe(false);
    expect(rows[0].speaker.sampleText).toBe('角色名');
  });

  it('行距太小时夹到下限，非法对齐退回左对齐', () => {
    const rows = normalizeTextBoxes([{ uid: 'tb1', lineHeight: 0.1, align: 'middle' }]);
    expect(rows[0].text.lineHeight).toBe(LINE_HEIGHT_MIN);
    expect(rows[0].text.align).toBe('left');
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
    expect(rows[0].speaker.rect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(rows[0].text.rect.x).toBeCloseTo(0.2);
    expect(rows[0].text.rect.y).toBeCloseTo(0.24);
    expect(rows[0].text.rect.w).toBeCloseTo(0.25);
    expect(rows[0].text.rect.h).toBeCloseTo(0.1);
  });

  it('老格式的坐标与锚点原样读回，showName=false 变成隐藏名字', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        rectSpace: 'canvas',
        showName: false,
        sampleName: '旁白',
        box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
        nameRect: { x: 0.2, y: 0.3, w: 0.4, h: 0.1 },
        textRect: { x: 0.2, y: 0.4, w: 0.4, h: 0.2 },
        anchors: { bg: { col: 3, row: 3 }, name: { col: 1, row: 2 }, text: { col: 9, row: -2 } },
      },
    ]);
    expect(rows[0].bg.rect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(rows[0].speaker.rect).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.1 });
    expect(rows[0].speaker.hidden).toBe(true);
    expect(rows[0].speaker.sampleText).toBe('旁白');
    expect(rows[0].bg.anchor).toEqual({ col: 3, row: 3 });
    expect(rows[0].speaker.anchor).toEqual({ col: 1, row: 2 });
    // 越界的锚点夹回 0–3
    expect(rows[0].text.anchor).toEqual({ col: 3, row: 0 });
  });

  it('新格式的三个控件原样读回，字体颜色归一化，字号不再夹上限', () => {    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        bg: {
          rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
          anchor: { col: 3, row: 0 },
          hidden: false,
          imageUid: 'img1',
          fontFamily: '',
          fontSize: 0,
          color: '#000000',
        },
        speaker: { hidden: true, color: '#fff', pivotX: 0.25 },
        text: { fontSize: 999, fontFamily: '黑体', sampleText: '示例', pivotY: 2 },
      },
    ]);
    expect(rows[0].bg.imageUid).toBe('img1');
    expect(rows[0].bg.anchor).toEqual({ col: 3, row: 0 });
    expect(rows[0].speaker.hidden).toBe(true);
    expect(rows[0].speaker.color).toBe('#FFFFFF');
    expect(rows[0].speaker.pivotX).toBe(0.25);
    expect(rows[0].text.fontSize).toBe(999);
    expect(rows[0].text.fontFamily).toBe('黑体');
    expect(rows[0].text.sampleText).toBe('示例');
    // 对齐值夹在 0–1
    expect(rows[0].text.pivotY).toBe(1);
    // 缺省的对齐是 0.5
    expect(rows[0].bg.pivotX).toBe(0.5);
    expect(rows[0].bg.pivotY).toBe(0.5);
  });

  it('出现效果、多行与层级都能读回来，越界的参数收进范围', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        layer: 5.6,
        text: {
          reveal: 'typewriter',
          typeSpeed: 500,
          punctuationPause: -1,
          fadeIn: 99,
          multiLine: true,
        },
      },
    ]);
    expect(rows[0].layer).toBe(6);
    expect(rows[0].text.reveal).toBe('typewriter');
    expect(rows[0].text.typeSpeed).toBe(TYPE_SPEED_MAX);
    expect(rows[0].text.punctuationPause).toBe(0);
    expect(rows[0].text.fadeIn).toBe(FADE_MAX);
    expect(rows[0].text.fadeOut).toBe(0.2);
    expect(rows[0].text.multiLine).toBe(true);
  });
});

describe('锚点与像素数字的换算', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it('左上锚点 + 左上对齐：位置就是左上角像素，尺寸就是宽高像素', () => {
    const slot = rectToSlot(rect, CELL, 0, 0);
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT);
    expect(slot.sizeX).toBeCloseTo(0.3 * CANVAS_WIDTH);
    expect(slot.sizeY).toBeCloseTo(0.4 * CANVAS_HEIGHT);
  });

  it('默认对齐（0.5, 0.5）：位置写控件中心相对锚点的偏移', () => {
    const slot = rectToSlot(rect, CELL);
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH + 0.15 * CANVAS_WIDTH);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT + 0.2 * CANVAS_HEIGHT);
  });

  it('居中锚点：位置是相对画面中心的偏移', () => {
    const slot = rectToSlot(rect, { col: 1, row: 1 }, 0, 0);
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH - CANVAS_WIDTH / 2);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT - CANVAS_HEIGHT / 2);
  });

  it('对齐换到右下（1, 1）之后，同一个矩形的位置数字跟着变', () => {
    const slot = rectToSlot(rect, CELL, 1, 1);
    expect(slot.posX).toBeCloseTo(0.1 * CANVAS_WIDTH + 0.3 * CANVAS_WIDTH);
    expect(slot.posY).toBeCloseTo(0.2 * CANVAS_HEIGHT + 0.4 * CANVAS_HEIGHT);
  });

  it('非拉伸的槽位数字转回矩形是原样', () => {
    const anchor: AnchorCell = { col: 2, row: 1 };
    const next = slotToRect(rectToSlot(rect, anchor), anchor, rect);
    expect(next.x).toBeCloseTo(rect.x);
    expect(next.y).toBeCloseTo(rect.y);
    expect(next.w).toBeCloseTo(rect.w);
    expect(next.h).toBeCloseTo(rect.h);
  });

  it('带对齐的槽位数字转回矩形也是原样', () => {
    const anchor: AnchorCell = { col: 1, row: 2 };
    const next = slotToRect(rectToSlot(rect, anchor, 0.25, 0.75), anchor, rect, 0.25, 0.75);
    expect(next.x).toBeCloseTo(rect.x);
    expect(next.y).toBeCloseTo(rect.y);
    expect(next.w).toBeCloseTo(rect.w);
    expect(next.h).toBeCloseTo(rect.h);
  });

  it('拉伸锚点用边距算矩形，尺寸写负数（-右边距 / -下边距）', () => {
    const anchor: AnchorCell = { col: 3, row: 3 };
    const next = slotToRect(
      {
        posX: 0.1 * CANVAS_WIDTH,
        posY: 0.2 * CANVAS_HEIGHT,
        sizeX: -0.6 * CANVAS_WIDTH,
        sizeY: -0.4 * CANVAS_HEIGHT,
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
        sizeX: -0.6 * CANVAS_WIDTH,
        sizeY: -0.6 * CANVAS_HEIGHT,
      },
      anchor,
      rect,
    );
    expect(next.w).toBe(MIN_RECT_SIDE);
    expect(next.h).toBe(MIN_RECT_SIDE);
  });
});
