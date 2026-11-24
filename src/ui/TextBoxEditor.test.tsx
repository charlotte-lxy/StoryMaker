// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../core/types';
import { createEmptyProject } from '../state/operations';
import { TextBoxEditor } from './TextBoxEditor';
import type { AssetLibrary } from './use-asset-library';

afterEach(cleanup);

const library: AssetLibrary = {
  available: false,
  folder: '',
  loading: false,
  error: '',
  byId: new Map(),
  refresh: () => undefined,
  upload: vi.fn(async () => ({ ok: true })),
  remove: vi.fn(async () => ({ ok: true })),
  rename: vi.fn(async () => ({ ok: true })),
};

function renderEditor(project: Project = createEmptyProject()) {
  const onChange = vi.fn();
  render(
    <TextBoxEditor project={project} assets={{ library, host: undefined }} onChange={onChange} />,
  );
  return { onChange };
}

/** 取最后一次 onChange 的项目 */
function lastProject(onChange: ReturnType<typeof vi.fn>): Project {
  return onChange.mock.calls.at(-1)?.[0] as Project;
}

/** 打开某个控件的选项卡 */
function openPart(name: '背景图' | '人物名称' | '台词'): void {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('文本框子模块', () => {
  it('打开就有一条默认文本框，画布上能看到人物名称与示例台词', () => {
    renderEditor();
    expect(screen.getByRole('tab', { name: '文本框 1' })).toBeTruthy();
    expect(document.querySelector('.textbox-name')?.textContent).toBe('角色名');
    expect(document.querySelector('.textbox-text')?.textContent).toBe('这是一段示例台词。');
    // 默认停在「背景图」这个控件上
    expect(screen.getByRole('tab', { name: '背景图' }).getAttribute('aria-selected')).toBe('true');
  });

  it('没选背景图时画布上不放图片，背景是全透明', () => {
    renderEditor();
    expect(document.querySelector('.textbox-bg')).toBeNull();
    expect(screen.getByRole('option', { name: '（无，全透明）' })).toBeTruthy();
  });

  it('新建按钮把新文本框加进列表并选中它', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByText('＋ 新建文本框'));
    const next = lastProject(onChange);
    expect(next.textBoxes).toHaveLength(2);
    expect(next.textBoxes?.[1].name).toBe('文本框 2');
    expect(next.ui?.textBoxUid).toBe(next.textBoxes?.[1].uid);
  });

  it('勾上「隐藏控件」后写回 hidden=true', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('隐藏控件'));
    expect(lastProject(onChange).textBoxes?.[0].bg.hidden).toBe(true);
  });

  it('控件被隐藏时画布上不画它，也不出把手', () => {
    const project = createEmptyProject();
    project.textBoxes![0].bg.hidden = true;
    project.textBoxes![0].speaker.hidden = false;
    renderEditor(project);
    expect(document.querySelector('.textbox-frame')).toBeNull();
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(0);

    fireEvent.pointerDown(document.querySelector('.textbox-text')!);
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(8);
  });

  it('名称与文本框 ID 写回项目', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByDisplayValue('文本框 1'), { target: { value: '旁白框' } });
    expect(lastProject(onChange).textBoxes?.[0].name).toBe('旁白框');

    fireEvent.change(screen.getByDisplayValue('TB_1'), { target: { value: 'TB_旁白' } });
    expect(lastProject(onChange).textBoxes?.[0].id).toBe('TB_旁白');
  });

  it('台词的允许多行与出现效果写回项目', () => {
    const { onChange } = renderEditor();
    openPart('台词');

    fireEvent.click(screen.getByLabelText(/允许多行/));
    expect(lastProject(onChange).textBoxes?.[0].text.multiLine).toBe(true);

    // 默认是立即显示，没有任何时长参数
    expect(screen.queryByLabelText(/淡入时长/)).toBeNull();
    fireEvent.change(screen.getByLabelText('出现效果'), { target: { value: 'fade' } });
    expect(lastProject(onChange).textBoxes?.[0].text.reveal).toBe('fade');
  });

  it('淡入淡出只显示淡入 / 淡出时长', () => {
    const project = createEmptyProject();
    project.textBoxes![0].text.reveal = 'fade';
    const { onChange } = renderEditor(project);
    openPart('台词');

    expect(screen.queryByLabelText(/速度/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/淡入时长/), { target: { value: '0.6' } });
    expect(lastProject(onChange).textBoxes?.[0].text.fadeIn).toBe(0.6);
    fireEvent.change(screen.getByLabelText(/淡出时长/), { target: { value: '0.1' } });
    expect(lastProject(onChange).textBoxes?.[0].text.fadeOut).toBe(0.1);
  });

  it('逐字只显示速度与标点停顿', () => {
    const project = createEmptyProject();
    project.textBoxes![0].text.reveal = 'typewriter';
    const { onChange } = renderEditor(project);
    openPart('台词');

    expect(screen.queryByLabelText(/淡入时长/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/速度/), { target: { value: '12' } });
    expect(lastProject(onChange).textBoxes?.[0].text.typeSpeed).toBe(12);
    fireEvent.change(screen.getByLabelText(/标点停顿/), { target: { value: '0.5' } });
    expect(lastProject(onChange).textBoxes?.[0].text.punctuationPause).toBe(0.5);
  });

  it('层级写回项目', () => {
    const { onChange } = renderEditor();
    const layer = screen.getByLabelText(/层级/) as HTMLInputElement;
    fireEvent.change(layer, { target: { value: '3' } });
    expect(lastProject(onChange).textBoxes?.[0].layer).toBe(3);
  });

  it('台词页能改示例文本、字号、字体、颜色、对齐与行距', () => {
    const { onChange } = renderEditor();
    openPart('台词');

    fireEvent.change(screen.getByDisplayValue('这是一段示例台词。'), {
      target: { value: '新的示例。' },
    });
    expect(lastProject(onChange).textBoxes?.[0].text.sampleText).toBe('新的示例。');

    const fontSize = screen.getByLabelText(/字体大小/) as HTMLInputElement;
    fireEvent.change(fontSize, { target: { value: '36' } });
    expect(lastProject(onChange).textBoxes?.[0].text.fontSize).toBe(36);

    fireEvent.change(screen.getByLabelText('字体样式'), { target: { value: '黑体' } });
    expect(lastProject(onChange).textBoxes?.[0].text.fontFamily).toBe('黑体');

    fireEvent.change(screen.getByLabelText('字体颜色'), { target: { value: '#ff0000' } });
    expect(lastProject(onChange).textBoxes?.[0].text.color).toBe('#FF0000');

    fireEvent.click(screen.getByText('居中'));
    expect(lastProject(onChange).textBoxes?.[0].text.align).toBe('center');

    const lineHeight = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(lineHeight, { target: { value: '2' } });
    expect(lastProject(onChange).textBoxes?.[0].text.lineHeight).toBe(2);
  });

  it('人物名称页改属性只动名字控件', () => {
    const { onChange } = renderEditor();
    openPart('人物名称');

    expect((screen.getByLabelText(/示例文本/) as HTMLInputElement).value).toBe('角色名');
    fireEvent.change(screen.getByLabelText('字体样式'), { target: { value: '宋体' } });
    expect(lastProject(onChange).textBoxes?.[0].speaker.fontFamily).toBe('宋体');
    expect(lastProject(onChange).textBoxes?.[0].text.fontFamily).toBe('微软雅黑');
  });

  it('字号不做输入限制，写多少就是多少', () => {
    const { onChange } = renderEditor();
    openPart('台词');
    fireEvent.change(screen.getByLabelText(/字体大小/), { target: { value: '999' } });
    expect(lastProject(onChange).textBoxes?.[0].text.fontSize).toBe(999);
  });

  it('对齐默认 0.5，改完写回控件自己的对齐', () => {
    const { onChange } = renderEditor();
    const pivotX = screen.getByLabelText('对齐X') as HTMLInputElement;
    const pivotY = screen.getByLabelText('对齐Y') as HTMLInputElement;
    expect(pivotX.value).toBe('0.50');
    expect(pivotY.value).toBe('0.50');

    fireEvent.change(pivotX, { target: { value: '0' } });
    fireEvent.blur(pivotX);
    expect(lastProject(onChange).textBoxes?.[0].bg.pivotX).toBe(0);

    fireEvent.change(pivotY, { target: { value: '2' } });
    fireEvent.blur(pivotY);
    expect(lastProject(onChange).textBoxes?.[0].bg.pivotY).toBe(1);
  });

  it('默认的八向把手在背景图上，点台词层就换过去', () => {
    renderEditor();
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(8);
    expect(document.querySelector('.textbox-frame')?.classList.contains('selected')).toBe(true);

    fireEvent.pointerDown(document.querySelector('.textbox-text')!);
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(8);
    expect(document.querySelector('.textbox-text')?.classList.contains('selected')).toBe(true);
    expect(document.querySelector('.textbox-frame')?.classList.contains('selected')).toBe(false);
    expect(screen.getByRole('tab', { name: '台词' }).getAttribute('aria-selected')).toBe('true');
  });

  it('点人物名称层切到名字控件', () => {
    renderEditor();
    fireEvent.pointerDown(document.querySelector('.textbox-name')!);
    expect(document.querySelector('.textbox-name')?.classList.contains('selected')).toBe(true);
    expect(screen.getByRole('tab', { name: '人物名称' }).getAttribute('aria-selected')).toBe('true');
  });

  it('位置数字按设计稿像素显示（含对齐的偏移），改完写回画布坐标', () => {
    const { onChange } = renderEditor();
    const posX = screen.getByLabelText('位置X') as HTMLInputElement;
    // 默认外框 left 96px、宽 1728px，对齐 0.5 → 位置 = 96 + 864
    expect(posX.value).toBe('960.0');
    fireEvent.change(posX, { target: { value: '1056' } });
    fireEvent.blur(posX);

    expect(lastProject(onChange).textBoxes?.[0].bg.rect.x).toBeCloseTo(0.1);
  });

  it('换锚点只换参考点，写回锚点且不动矩形', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '锚点：居中' }));

    const next = lastProject(onChange);
    expect(next.textBoxes?.[0].bg.anchor).toEqual({ col: 1, row: 1 });
    expect(next.textBoxes?.[0].bg.rect).toEqual(createEmptyProject().textBoxes?.[0].bg.rect);
  });

  it('有两条时点列表里的另一个，会记成下次打开的选中项', () => {
    const project = addSecond();
    const { onChange } = renderEditor(project);
    fireEvent.click(screen.getByRole('tab', { name: '文本框 2' }));
    expect(lastProject(onChange).ui?.textBoxUid).toBe(project.textBoxes?.[1].uid);
  });

  it('删除要先确认，确认后一条都不剩', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByText('删除这个文本框'));
    // 弹窗里的确认按钮
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(lastProject(onChange).textBoxes).toEqual([]);
  });

  it('一条都没有时显示空状态与新建入口', () => {
    const project = createEmptyProject();
    project.textBoxes = [];
    renderEditor(project);
    expect(screen.getByText(/还没有文本框/)).toBeTruthy();
    expect(screen.getByText('＋ 新建文本框')).toBeTruthy();
  });
});

/** 两条文本框的项目 */
function addSecond(): Project {
  const project = createEmptyProject();
  const first = project.textBoxes?.[0];
  if (first === undefined) throw new Error('默认项目应该带一条文本框');
  project.textBoxes = [first, { ...first, uid: 'tb2', name: '文本框 2' }];
  return project;
}
