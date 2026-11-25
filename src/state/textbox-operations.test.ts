import { describe, expect, it } from 'vitest';

import { createEmptyProject } from './operations';
import {
  addControl,
  addTextBox,
  moveControl,
  rememberTextBox,
  removeControl,
  removeTextBox,
  setControlAnchor,
  setControlProps,
  setControlRect,
  textBoxesOf,
  updateTextBox,
} from './textbox-operations';
import type { TextBoxControl, TextBoxRow } from '../core/types';

function controlOf(row: TextBoxRow, uid: string): TextBoxControl {
  const found = row.controls.find((control) => control.uid === uid);
  if (found === undefined) throw new Error('没有这个控件');
  return found;
}

function byContent(row: TextBoxRow, content: 'speaker' | 'line'): TextBoxControl {
  const found = row.controls.find(
    (control) => control.kind === 'text' && control.content === content,
  );
  if (found === undefined) throw new Error(`没有 ${content} 控件`);
  return found;
}

describe('文本框的操作', () => {
  it('新项目自带一条文本框，默认三个控件', () => {
    const project = createEmptyProject();
    const rows = textBoxesOf(project);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('文本框 1');
    expect(rows[0].controls.map((control) => control.kind)).toEqual(['image', 'text', 'text']);
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
    const row = textBoxesOf(project)[0];
    const speaker = byContent(row, 'speaker');
    const line = byContent(row, 'line');
    const next = setControlProps(project, row.uid, speaker.uid, { fontSize: 24, content: 'line' });
    const updated = textBoxesOf(next)[0];
    expect(controlOf(updated, speaker.uid).fontSize).toBe(24);
    expect(controlOf(updated, speaker.uid).content).toBe('line');
    expect(controlOf(updated, line.uid).fontSize).toBe(line.fontSize);
  });

  it('改矩形时允许越出画布，但收在合理范围里', () => {
    const project = createEmptyProject();
    const row = textBoxesOf(project)[0];
    const image = row.controls[0];
    const next = setControlRect(project, row.uid, image.uid, { x: 5, y: -2, w: 0.1, h: 0.1 });
    expect(controlOf(textBoxesOf(next)[0], image.uid).rect).toEqual({
      x: 2,
      y: -1,
      w: 0.1,
      h: 0.1,
    });
  });

  it('换锚点只动那一个控件的锚点', () => {
    const project = createEmptyProject();
    const row = textBoxesOf(project)[0];
    const line = byContent(row, 'line');
    const image = row.controls[0];
    const next = setControlAnchor(project, row.uid, line.uid, { col: 3, row: 3 });
    const updated = textBoxesOf(next)[0];
    expect(controlOf(updated, line.uid).anchor).toEqual({ col: 3, row: 3 });
    expect(controlOf(updated, image.uid).anchor).toEqual({ col: 0, row: 0 });
  });

  it('两个文本控件的矩形各自独立保存', () => {
    const project = createEmptyProject();
    const row = textBoxesOf(project)[0];
    const speaker = byContent(row, 'speaker');
    const line = byContent(row, 'line');
    const next = setControlRect(project, row.uid, speaker.uid, {
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.2,
    });
    const updated = textBoxesOf(next)[0];
    expect(controlOf(updated, speaker.uid).rect).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(controlOf(updated, line.uid).rect).toEqual(controlOf(row, line.uid).rect);
  });

  it('添加控件按类型排名字，位置用该类型的默认矩形', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const once = addControl(project, uid, 'image');
    const twice = addControl(once, uid, 'image');
    const thrice = addControl(twice, uid, 'portrait');
    const row = textBoxesOf(thrice)[0];
    expect(row.controls.map((control) => control.name)).toEqual([
      '背景图',
      '人物名称',
      '台词',
      '图片 1',
      '图片 2',
      '立绘弹窗 1',
    ]);
    expect(row.controls.at(-1)?.kind).toBe('portrait');
    expect(row.controls.at(-1)?.portraitMode).toBe('single');
  });

  it('删除控件只掉那一个，别的不动', () => {
    const project = createEmptyProject();
    const row = textBoxesOf(project)[0];
    const speaker = byContent(row, 'speaker');
    const next = removeControl(project, row.uid, speaker.uid);
    const updated = textBoxesOf(next)[0];
    expect(updated.controls).toHaveLength(2);
    expect(updated.controls.map((control) => control.kind)).toEqual(['image', 'text']);
    expect(updated.controls[1].content).toBe('line');
  });

  it('记住上次选中的文本框，重复调用不产生新对象', () => {
    const project = createEmptyProject();
    const uid = textBoxesOf(project)[0].uid;
    const once = rememberTextBox(project, uid);
    expect(rememberTextBox(once, uid)).toBe(once);
  });

  it('拖动排序换控件顺序，越界或没动就原样返回', () => {
    const project = createEmptyProject();
    const row = textBoxesOf(project)[0];
    const names = (next: typeof project): string[] =>
      textBoxesOf(next)[0].controls.map((control) => control.name);

    expect(names(moveControl(project, row.uid, 2, 0))).toEqual(['台词', '背景图', '人物名称']);
    expect(names(moveControl(project, row.uid, 0, 1))).toEqual(['人物名称', '背景图', '台词']);
    expect(moveControl(project, row.uid, 1, 1)).toBe(project);
    expect(moveControl(project, row.uid, -1, 0)).toBe(project);
    expect(moveControl(project, row.uid, 0, 9)).toBe(project);
    expect(moveControl(project, 'nope', 0, 1)).toBe(project);
  });
});
