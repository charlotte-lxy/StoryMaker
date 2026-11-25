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
import type { AnchorCell, TextBoxControl, TextBoxRow } from './types';

const CELL: AnchorCell = { col: 0, row: 0 };

function textControl(row: TextBoxRow, content: 'speaker' | 'line'): TextBoxControl {
  const found = row.controls.find(
    (control) => control.kind === 'text' && control.content === content,
  );
  if (found === undefined) throw new Error(`没有 ${content} 文本控件`);
  return found;
}

describe('文本框的默认值与归一化', () => {
  it('新建的文本框贴在画面下方，默认带图片 / 人物名称 / 台词三个控件', () => {
    const row = createDefaultTextBox();
    expect(row.name).toBe('文本框 1');
    expect(row.layer).toBe(0);
    expect(row.rectSpace).toBe('canvas');

    expect(row.controls.map((control) => control.kind)).toEqual(['image', 'text', 'text']);
    expect(row.controls.map((control) => control.name)).toEqual(['背景图', '人物名称', '台词']);
    expect(new Set(row.controls.map((control) => control.uid)).size).toBe(3);

    const [image, speaker, line] = row.controls;
    expect(image.rect).toEqual(DEFAULT_TEXT_BOX_RECT);
    expect(image.anchor).toEqual(DEFAULT_ANCHOR);
    expect(image.imageUid).toBe('');

    expect(speaker.content).toBe('speaker');
    expect(speaker.sampleText).toBe('角色名');
    expect(speaker.fontFamily).toBe('微软雅黑');
    expect(speaker.fontSize).toBe(40);
    expect(speaker.color).toBe('#FFFFFF');

    expect(line.content).toBe('line');
    expect(line.sampleText).toBe('这是一段示例台词。');
    expect(line.fontSize).toBe(42);
    expect(line.align).toBe('left');
    expect(line.lineHeight).toBe(1.5);
    expect(line.reveal).toBe('instant');
    expect(line.multiLine).toBe(false);

    // 名字 / 台词都收在外框里面，但存的是画布坐标
    expect(speaker.rect.y).toBeGreaterThanOrEqual(image.rect.y);
    expect(speaker.rect.y + speaker.rect.h).toBeLessThanOrEqual(image.rect.y + image.rect.h);
    expect(line.rect.y).toBeGreaterThanOrEqual(image.rect.y);
    expect(line.rect.y + line.rect.h).toBeLessThanOrEqual(image.rect.y + image.rect.h);
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

  it('缺字段的老行会补齐，并摊成图片 / 人物名称 / 台词三个控件', () => {
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
    expect(rows[0].id).toBe('TB_1');
    expect(rows[0].controls.map((control) => control.kind)).toEqual(['image', 'text', 'text']);
    expect(rows[0].controls[0].rect).toEqual({ x: 0.9, y: 0.9, w: 0.4, h: 0.4 });
    expect(textControl(rows[0], 'speaker').sampleText).toBe('角色名');
    expect(textControl(rows[0], 'line').align).toBe('center');
    expect(textControl(rows[0], 'line').lineHeight).toBe(LINE_HEIGHT_MAX);
  });

  it('行距太小时夹到下限，非法对齐退回左对齐', () => {
    const rows = normalizeTextBoxes([{ uid: 'tb1', lineHeight: 0.1, align: 'middle' }]);
    expect(textControl(rows[0], 'line').lineHeight).toBe(LINE_HEIGHT_MIN);
    expect(textControl(rows[0], 'line').align).toBe('left');
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
    const speaker = textControl(rows[0], 'speaker');
    const line = textControl(rows[0], 'line');
    expect(rows[0].rectSpace).toBe('canvas');
    expect(rows[0].controls[0].rect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(speaker.rect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(line.rect.x).toBeCloseTo(0.2);
    expect(line.rect.y).toBeCloseTo(0.24);
    expect(line.rect.w).toBeCloseTo(0.25);
    expect(line.rect.h).toBeCloseTo(0.1);
  });

  it('老格式的坐标与锚点原样读回，showName=false 也照旧摊成三个控件', () => {
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
    const speaker = textControl(rows[0], 'speaker');
    const line = textControl(rows[0], 'line');
    expect(rows[0].controls).toHaveLength(3);
    expect(rows[0].controls[0].rect).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(speaker.rect).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.1 });
    expect(speaker.sampleText).toBe('旁白');
    expect(rows[0].controls[0].anchor).toEqual({ col: 3, row: 3 });
    expect(speaker.anchor).toEqual({ col: 1, row: 2 });
    // 越界的锚点夹回 0–3
    expect(line.anchor).toEqual({ col: 3, row: 0 });
  });

  it('新格式按控件数组原样读回，字体颜色归一化，字号不再夹上限', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        controls: [
          {
            uid: 'c1',
            kind: 'image',
            name: '底图',
            rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
            anchor: { col: 3, row: 0 },
            imageUid: 'img1',
          },
          {
            uid: 'c2',
            kind: 'text',
            content: 'speaker',
            color: '#fff',
            pivotX: 0.25,
          },
          {
            uid: 'c3',
            kind: 'text',
            content: 'line',
            fontSize: 999,
            fontFamily: '黑体',
            sampleText: '示例',
            pivotY: 2,
          },
        ],
      },
    ]);
    expect(rows[0].controls.map((control) => control.uid)).toEqual(['c1', 'c2', 'c3']);
    expect(rows[0].controls[0].name).toBe('底图');
    expect(rows[0].controls[0].imageUid).toBe('img1');
    expect(rows[0].controls[0].anchor).toEqual({ col: 3, row: 0 });

    const speaker = textControl(rows[0], 'speaker');
    expect(speaker.color).toBe('#FFFFFF');
    expect(speaker.pivotX).toBe(0.25);

    const line = textControl(rows[0], 'line');
    expect(line.fontSize).toBe(999);
    expect(line.fontFamily).toBe('黑体');
    expect(line.sampleText).toBe('示例');
    // 对齐值夹在 0–1
    expect(line.pivotY).toBe(1);
    // 缺省的对齐是 0.5
    expect(rows[0].controls[0].pivotX).toBe(0.5);
    expect(rows[0].controls[0].pivotY).toBe(0.5);
  });

  it('立绘弹窗的显示方式与预览角色能读回来，不认识的类型退回文本', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        controls: [
          {
            uid: 'c1',
            kind: 'portrait',
            name: '立绘',
            portraitMode: 'multi',
            portraits: [
              { characterUid: 'ch1', expression: '开心' },
              { characterUid: '', expression: '' },
            ],
          },
          { uid: 'c2', kind: 'video', content: 'speaker' },
        ],
      },
    ]);
    const portrait = rows[0].controls[0];
    expect(portrait.kind).toBe('portrait');
    expect(portrait.portraitMode).toBe('multi');
    expect(portrait.portraits).toEqual([
      { characterUid: 'ch1', expression: '开心' },
      { characterUid: '', expression: '' },
    ]);
    expect(rows[0].controls[1].kind).toBe('text');
  });

  it('出现效果、多行与层级都能读回来，越界的参数收进范围', () => {
    const rows = normalizeTextBoxes([
      {
        uid: 'tb1',
        layer: 5.6,
        controls: [
          {
            uid: 'c1',
            kind: 'text',
            content: 'line',
            reveal: 'typewriter',
            typeSpeed: 500,
            punctuationPause: -1,
            fadeIn: 99,
            multiLine: true,
          },
        ],
      },
    ]);
    const line = textControl(rows[0], 'line');
    expect(rows[0].layer).toBe(6);
    expect(line.reveal).toBe('typewriter');
    expect(line.typeSpeed).toBe(TYPE_SPEED_MAX);
    expect(line.punctuationPause).toBe(0);
    expect(line.fadeIn).toBe(FADE_MAX);
    expect(line.fadeOut).toBe(0.2);
    expect(line.multiLine).toBe(true);
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
