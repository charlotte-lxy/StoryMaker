import { describe, expect, it } from 'vitest';

import { createEmptyProject } from './operations';
import {
  addTextBox,
  rememberTextBox,
  removeTextBox,
  setTextBoxRect,
  textBoxesOf,
  updateTextBox,
} from './textbox-operations';

describe('文本框的操作', () => {
  it('新项目自带一条文本框', () => {
    const project = createEmptyProject();
    expect(textBoxesOf(project)).toHaveLength(1);
    expect(textBoxesOf(project)[0].name).toBe('文本框 1');
  });

  it('新建按顺序编号，并在项目里追加', () => {
    const project = addTextBox(addTextBox(createEmptyProject()));
    const rows = textBoxesOf(project);
    expect(rows.map((row) => row.name)).toEqual(['文本框 1', '文本框 2', '文本框 3']);
    expect(rows[2].uid).not.toBe(rows[0].uid);
  });

  it('删除一条后，记住的选中项跟着清掉', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const remembered = rememberTextBox(project, uid);
    expect(remembered.ui?.textBoxUid).toBe(uid);

    const next = removeTextBox(remembered, uid);
    expect(textBoxesOf(next)).toEqual([]);
    expect(next.ui?.textBoxUid).toBeUndefined();
  });

  it('改字段只动指定的那一条', () => {
    const project = addTextBox(createEmptyProject());
    const [first] = textBoxesOf(project);
    const next = updateTextBox(project, first.uid, { align: 'right', showName: false });
    expect(textBoxesOf(next)[0].align).toBe('right');
    expect(textBoxesOf(next)[0].showName).toBe(false);
    expect(textBoxesOf(next)[1].align).toBe('left');
    expect(textBoxesOf(project)[0].align).toBe('left');
  });

  it('改矩形时把越界坐标夹回来', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxRect(project, uid, 'box', { x: 5, y: -2, w: 0.1, h: 0.1 });
    expect(textBoxesOf(next)[0].box).toEqual({ x: 0.9, y: 0, w: 0.1, h: 0.1 });
  });

  it('名字 / 台词的矩形也各自独立保存', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxRect(project, uid, 'nameRect', { x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(textBoxesOf(next)[0].nameRect).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(textBoxesOf(next)[0].box).toEqual(textBoxesOf(project)[0].box);
    expect(textBoxesOf(next)[0].textRect).toEqual(textBoxesOf(project)[0].textRect);
  });

  it('记住上次选中的文本框，重复调用不产生新对象', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const once = rememberTextBox(project, uid);
    expect(rememberTextBox(once, uid)).toBe(once);
  });
});
