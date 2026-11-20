import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEXT_BOX_RECT,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MIN_RECT_SIDE,
  clampRect,
  createDefaultTextBox,
  normalizeTextBoxes,
} from './textbox';

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
    // 名字 / 台词都收在外框里面
    expect(row.nameRect.y + row.nameRect.h).toBeLessThanOrEqual(1);
    expect(row.textRect.y + row.textRect.h).toBeLessThanOrEqual(1);
  });

  it('每个新建的文本框 uid 不一样', () => {
    expect(createDefaultTextBox().uid).not.toBe(createDefaultTextBox().uid);
  });

  it('clampRect 把越界的矩形收回 0–1', () => {
    const fallback = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(clampRect({ x: -1, y: 2, w: 3, h: 0.5 }, fallback)).toEqual({
      x: 0,
      y: 0.5,
      w: 1,
      h: 0.5,
    });
    expect(clampRect({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 }, fallback)).toEqual({
      x: 0.5,
      y: 0.5,
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
    expect(rows[0].box.x).toBe(0.6);
    expect(rows[0].box.y).toBe(0.6);
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
});
