// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Project, TextBoxControl, TextBoxRow } from '../core/types';
import { createPortraitControl } from '../core/textbox';
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

function controlsOf(project: Project): TextBoxControl[] {
  return project.textBoxes?.[0]?.controls ?? [];
}

function controlByContent(project: Project, content: 'speaker' | 'line'): TextBoxControl {
  const found = controlsOf(project).find(
    (control) => control.kind === 'text' && control.content === content,
  );
  if (found === undefined) throw new Error(`没有 ${content} 控件`);
  return found;
}

/** 打开某个控件的选项卡（「控件」那个 tablist 里） */
function openControl(name: string): void {
  const list = screen.getByRole('tablist', { name: '控件' });
  fireEvent.click(within(list).getByRole('tab', { name }));
}

describe('文本框子模块', () => {
  it('打开就有一条默认文本框，画布上能看到名字与示例台词，默认选中第一个控件', () => {
    renderEditor();
    expect(screen.getByRole('tab', { name: '文本框 1' })).toBeTruthy();
    expect(document.querySelector('.textbox-frame')).not.toBeNull();
    expect(document.querySelector('.textbox-text[data-content="speaker"]')?.textContent).toBe(
      '角色名',
    );
    expect(document.querySelector('.textbox-text[data-content="line"]')?.textContent).toBe(
      '这是一段示例台词。',
    );
    expect(screen.getByRole('tab', { name: '背景图' }).getAttribute('aria-selected')).toBe('true');
  });

  it('没选图片时画布上不放图片，背景是全透明', () => {
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

  it('「添加控件」能加一个立绘弹窗，名字自动排', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByText('＋ 立绘弹窗'));
    const added = controlsOf(lastProject(onChange)).at(-1);
    expect(added?.kind).toBe('portrait');
    expect(added?.name).toBe('立绘弹窗 1');
    expect(added?.rect).toEqual({ x: 0.3, y: 0.08, w: 0.4, h: 0.84 });
  });

  it('控件名与文本框名称、ID 都写回项目', () => {
    const { onChange } = renderEditor();

    // 控件名在控件列表里点铅笔改
    fireEvent.click(screen.getByRole('button', { name: '重命名控件：背景图' }));
    fireEvent.change(screen.getByLabelText('控件名'), { target: { value: '底图' } });
    expect(controlsOf(lastProject(onChange))[0].name).toBe('底图');

    fireEvent.change(screen.getByDisplayValue('文本框 1'), { target: { value: '旁白框' } });
    expect(lastProject(onChange).textBoxes?.[0].name).toBe('旁白框');

    fireEvent.change(screen.getByDisplayValue('TB_1'), { target: { value: 'TB_旁白' } });
    expect(lastProject(onChange).textBoxes?.[0].id).toBe('TB_旁白');
  });

  it('删除控件要先确认，确认后只掉那一个', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '删除控件：背景图' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(controlsOf(lastProject(onChange))).toHaveLength(2);
  });

  it('图片控件能选图片表里的图', () => {
    const project = createEmptyProject();
    project.images = [{ uid: 'img1', id: 'IMG_底', name: '底图' }];
    const { onChange } = renderEditor(project);
    fireEvent.change(screen.getByLabelText('图片'), { target: { value: 'img1' } });
    expect(controlsOf(lastProject(onChange))[0].imageUid).toBe('img1');
  });

  it('字体下拉里能选到字体子模块导入的字体，只改台词控件', () => {
    const project = createEmptyProject();
    project.fonts = [{ uid: 'font-1', name: '思源黑体', fileName: 'SourceHanSans.ttf' }];
    const { onChange } = renderEditor(project);
    openControl('台词');

    const select = screen.getByLabelText('字体样式') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain('思源黑体');

    fireEvent.change(select, { target: { value: '思源黑体' } });
    const next = lastProject(onChange);
    expect(controlByContent(next, 'line').fontFamily).toBe('思源黑体');
    expect(controlByContent(next, 'speaker').fontFamily).toBe('微软雅黑');
  });

  it('台词控件的允许多行与出现效果写回项目', () => {
    const { onChange } = renderEditor();
    openControl('台词');

    fireEvent.click(screen.getByLabelText(/允许多行/));
    expect(controlByContent(lastProject(onChange), 'line').multiLine).toBe(true);

    // 默认是立即显示，没有任何时长参数
    expect(screen.queryByLabelText(/淡入时长/)).toBeNull();
    fireEvent.change(screen.getByLabelText('出现效果'), { target: { value: 'fade' } });
    expect(controlByContent(lastProject(onChange), 'line').reveal).toBe('fade');
  });

  it('淡入淡出只显示淡入 / 淡出时长', () => {
    const project = createEmptyProject();
    controlByContent(project, 'line').reveal = 'fade';
    const { onChange } = renderEditor(project);
    openControl('台词');

    expect(screen.queryByLabelText(/速度/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/淡入时长/), { target: { value: '0.6' } });
    expect(controlByContent(lastProject(onChange), 'line').fadeIn).toBe(0.6);
    fireEvent.change(screen.getByLabelText(/淡出时长/), { target: { value: '0.1' } });
    expect(controlByContent(lastProject(onChange), 'line').fadeOut).toBe(0.1);
  });

  it('逐字只显示速度与标点停顿', () => {
    const project = createEmptyProject();
    controlByContent(project, 'line').reveal = 'typewriter';
    const { onChange } = renderEditor(project);
    openControl('台词');

    expect(screen.queryByLabelText(/淡入时长/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/速度/), { target: { value: '12' } });
    expect(controlByContent(lastProject(onChange), 'line').typeSpeed).toBe(12);
    fireEvent.change(screen.getByLabelText(/标点停顿/), { target: { value: '0.5' } });
    expect(controlByContent(lastProject(onChange), 'line').punctuationPause).toBe(0.5);
  });

  it('层级写回项目', () => {
    const { onChange } = renderEditor();
    const layer = screen.getByLabelText(/层级/) as HTMLInputElement;
    fireEvent.change(layer, { target: { value: '3' } });
    expect(lastProject(onChange).textBoxes?.[0].layer).toBe(3);
  });

  it('台词控件能改示例文本、字号、字体、颜色、对齐与行距', () => {
    const { onChange } = renderEditor();
    openControl('台词');

    fireEvent.change(screen.getByDisplayValue('这是一段示例台词。'), {
      target: { value: '新的示例。' },
    });
    expect(controlByContent(lastProject(onChange), 'line').sampleText).toBe('新的示例。');

    const fontSize = screen.getByLabelText(/字体大小/) as HTMLInputElement;
    fireEvent.change(fontSize, { target: { value: '36' } });
    expect(controlByContent(lastProject(onChange), 'line').fontSize).toBe(36);

    fireEvent.change(screen.getByLabelText('字体样式'), { target: { value: '黑体' } });
    expect(controlByContent(lastProject(onChange), 'line').fontFamily).toBe('黑体');

    fireEvent.change(screen.getByLabelText('字体颜色'), { target: { value: '#ff0000' } });
    expect(controlByContent(lastProject(onChange), 'line').color).toBe('#FF0000');

    fireEvent.click(screen.getByRole('button', { name: '居中' }));
    expect(controlByContent(lastProject(onChange), 'line').align).toBe('center');

    fireEvent.click(screen.getByRole('button', { name: '垂直排列：下对齐' }));
    expect(controlByContent(lastProject(onChange), 'line').verticalAlign).toBe('bottom');
    const lineHeight = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(lineHeight, { target: { value: '2' } });
    expect(controlByContent(lastProject(onChange), 'line').lineHeight).toBe(2);
  });

  it('人物名称控件改成台词内容之后，说话人名字就不显示了', () => {
    const { onChange } = renderEditor();
    openControl('人物名称');

    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'line' } });
    expect(controlsOf(lastProject(onChange))[1].content).toBe('line');
  });

  it('人物名称控件改字号只动它自己', () => {
    const { onChange } = renderEditor();
    openControl('人物名称');

    fireEvent.change(screen.getByLabelText(/字体大小/), { target: { value: '30' } });
    const next = lastProject(onChange);
    expect(controlByContent(next, 'speaker').fontSize).toBe(30);
    expect(controlByContent(next, 'line').fontSize).toBe(42);
  });

  it('字号不做输入限制，写多少就是多少', () => {
    const { onChange } = renderEditor();
    openControl('台词');
    fireEvent.change(screen.getByLabelText(/字体大小/), { target: { value: '999' } });
    expect(controlByContent(lastProject(onChange), 'line').fontSize).toBe(999);
  });

  it('对齐默认 0.5，改完写回当前控件的对齐', () => {
    const { onChange } = renderEditor();
    const pivotX = screen.getByLabelText('对齐X') as HTMLInputElement;
    const pivotY = screen.getByLabelText('对齐Y') as HTMLInputElement;
    expect(pivotX.value).toBe('0.50');
    expect(pivotY.value).toBe('0.50');

    fireEvent.change(pivotX, { target: { value: '0' } });
    fireEvent.blur(pivotX);
    expect(controlsOf(lastProject(onChange))[0].pivotX).toBe(0);

    fireEvent.change(pivotY, { target: { value: '2' } });
    fireEvent.blur(pivotY);
    expect(controlsOf(lastProject(onChange))[0].pivotY).toBe(1);
  });

  it('默认的八向把手在第一个控件上，点台词层就换过去', () => {
    renderEditor();
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(8);
    expect(document.querySelector('.textbox-frame')?.classList.contains('selected')).toBe(true);

    fireEvent.pointerDown(document.querySelector('.textbox-text[data-content="line"]')!);
    expect(document.querySelectorAll('.textbox-handle')).toHaveLength(8);
    expect(
      document.querySelector('.textbox-text[data-content="line"]')?.classList.contains('selected'),
    ).toBe(true);
    expect(document.querySelector('.textbox-frame')?.classList.contains('selected')).toBe(false);
    expect(screen.getByRole('tab', { name: '台词' }).getAttribute('aria-selected')).toBe('true');
  });

  it('点人物名称层切到名字控件', () => {
    renderEditor();
    fireEvent.pointerDown(document.querySelector('.textbox-text[data-content="speaker"]')!);
    expect(
      document
        .querySelector('.textbox-text[data-content="speaker"]')
        ?.classList.contains('selected'),
    ).toBe(true);
    expect(screen.getByRole('tab', { name: '人物名称' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('位置数字按设计稿像素显示（含对齐的偏移），改完写回画布坐标', () => {
    const { onChange } = renderEditor();
    const posX = screen.getByLabelText('位置X') as HTMLInputElement;
    // 默认图片控件 left 96px、宽 1728px，对齐 0.5 → 位置 = 96 + 864
    expect(posX.value).toBe('960.0');
    fireEvent.change(posX, { target: { value: '1056' } });
    fireEvent.blur(posX);

    expect(controlsOf(lastProject(onChange))[0].rect.x).toBeCloseTo(0.1);
  });

  it('换锚点只换参考点，写回锚点且不动矩形', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '锚点：居中' }));

    const next = lastProject(onChange);
    expect(controlsOf(next)[0].anchor).toEqual({ col: 1, row: 1 });
    expect(controlsOf(next)[0].rect).toEqual(controlsOf(createEmptyProject())[0].rect);
  });

  it('立绘弹窗能选显示方式、预览角色与表情，多张时能加一行', () => {
    const project = createEmptyProject();
    project.characters = [
      {
        uid: 'cha1',
        id: 'CHA_雪',
        name: '西园寺雪',
        nameEn: '',
        nameJa: '',
        textBoxUid: project.textBoxes?.[0]?.uid ?? '',
        aliases: [],
        expressions: ['开心', '生气'],
        actions: [],
      },
      {
        uid: 'cha2',
        id: 'CHA_樱',
        name: '樱',
        nameEn: '',
        nameJa: '',
        textBoxUid: project.textBoxes?.[0]?.uid ?? '',
        aliases: [],
        expressions: ['微笑'],
        actions: [],
      },
    ];
    const first = project.textBoxes?.[0];
    if (first === undefined) throw new Error('默认项目应该带一条文本框');
    const portrait = createPortraitControl({ x: 0.3, y: 0.08, w: 0.4, h: 0.84 }, '立绘弹窗 1');
    portrait.portraitMode = 'multi';
    portrait.portraits = [{ characterUid: 'cha1', expression: '' }];
    first.controls = [...first.controls, portrait];
    const { onChange } = renderEditor(project);
    openControl('立绘弹窗 1');

    fireEvent.change(screen.getByLabelText('预览角色 1'), { target: { value: 'cha2' } });
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraits[0].characterUid).toBe('cha2');

    fireEvent.change(screen.getByLabelText('预览表情 1'), { target: { value: '开心' } });
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraits[0].expression).toBe('开心');

    fireEvent.click(screen.getByText('＋ 加一行预览'));
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraits).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('显示方式'), { target: { value: 'single' } });
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraitMode).toBe('single');
  });

  it('立绘弹窗能选排列方式、勾上限制立绘长宽', () => {
    const project = createEmptyProject();
    const first = project.textBoxes?.[0];
    if (first === undefined) throw new Error('默认项目应该带一条文本框');
    const portrait = createPortraitControl({ x: 0.3, y: 0.08, w: 0.4, h: 0.84 }, '立绘弹窗 1');
    first.controls = [...first.controls, portrait];
    const { onChange } = renderEditor(project);
    openControl('立绘弹窗 1');

    fireEvent.change(screen.getByLabelText('排列方式'), { target: { value: 'pack' } });
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraitLayout).toBe('pack');

    const limit = screen.getByLabelText(/限制立绘长宽/) as HTMLInputElement;
    expect(limit.checked).toBe(false);
    fireEvent.click(limit);
    expect(controlsOf(lastProject(onChange)).at(-1)?.portraitLimit).toBe(true);
  });

  it('控件列表是竖着的，最上面是最上层，拖动左边的把手能换层级', () => {
    const project = createEmptyProject();
    const first = project.textBoxes?.[0];
    if (first === undefined) throw new Error('默认项目应该带一条文本框');
    const { onChange } = renderEditor(project);

    const list = screen.getByRole('tablist', { name: '控件' });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    const names = within(list)
      .getAllByRole('tab')
      .map((node) => node.textContent ?? '');
    expect(names).toEqual(['台词', '人物名称', '背景图']);
    expect(document.querySelectorAll('.textbox-part-grip')).toHaveLength(3);

    const rows = document.querySelectorAll('.textbox-part-row');
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    expect(controlsOf(lastProject(onChange)).map((item) => item.name)).toEqual([
      '台词',
      '背景图',
      '人物名称',
    ]);
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
  const first: TextBoxRow | undefined = project.textBoxes?.[0];
  if (first === undefined) throw new Error('默认项目应该带一条文本框');
  project.textBoxes = [first, { ...first, uid: 'tb2', name: '文本框 2' }];
  return project;
}
