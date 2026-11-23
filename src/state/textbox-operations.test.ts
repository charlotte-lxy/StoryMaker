import { describe, expect, it } from 'vitest';

import { createEmptyProject } from './operations';
import {
  addTextBox,
  rememberTextBox,
  removeTextBox,
  setTextBoxAnchor,
  setTextBoxControl,
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

  it('改名字 / ID 只动指定的那一条', () => {
    const project = addTextBox(createEmptyProject());
    const [first] = textBoxesOf(project);
    const next = updateTextBox(project, first.uid, { name: '旁白框', id: 'TB_旁白' });
    expect(textBoxesOf(next)[0].name).toBe('旁白框');
    expect(textBoxesOf(next)[0].id).toBe('TB_旁白');
    expect(textBoxesOf(next)[1].name).toBe('文本框 2');
    expect(textBoxesOf(project)[0].name).toBe('文本框 1');
  });

  it('改控件的属性只动那一个控件', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxControl(project, uid, 'speaker', { hidden: true, fontSize: 24 });
    expect(textBoxesOf(next)[0].speaker.hidden).toBe(true);
    expect(textBoxesOf(next)[0].speaker.fontSize).toBe(24);
    expect(textBoxesOf(next)[0].text.hidden).toBe(false);
    expect(textBoxesOf(next)[0].text.fontSize).toBe(42);
  });

  it('改矩形时允许越出画布，但收在合理范围里', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxRect(project, uid, 'bg', { x: 5, y: -2, w: 0.1, h: 0.1 });
    expect(textBoxesOf(next)[0].bg.rect).toEqual({ x: 2, y: -1, w: 0.1, h: 0.1 });
  });

  it('换锚点只动那一个控件的锚点', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxAnchor(project, uid, 'text', { col: 3, row: 3 });
    expect(textBoxesOf(next)[0].text.anchor).toEqual({ col: 3, row: 3 });
    expect(textBoxesOf(next)[0].bg.anchor).toEqual({ col: 0, row: 0 });
  });

  it('人物名称 / 台词的矩形也各自独立保存', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const next = setTextBoxRect(project, uid, 'speaker', { x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(textBoxesOf(next)[0].speaker.rect).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(textBoxesOf(next)[0].bg.rect).toEqual(textBoxesOf(project)[0].bg.rect);
    expect(textBoxesOf(next)[0].text.rect).toEqual(textBoxesOf(project)[0].text.rect);
  });

  it('记住上次选中的文本框，重复调用不产生新对象', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const once = rememberTextBox(project, uid);
    expect(rememberTextBox(once, uid)).toBe(once);
  });
});
