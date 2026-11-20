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

describe('文本框子模块', () => {
  it('打开就有一条默认文本框，画布上能看到名字与示例台词', () => {
    renderEditor();
    expect(screen.getByRole('tab', { name: '文本框 1' })).toBeTruthy();
    expect(document.querySelector('.textbox-name')?.textContent).toBe('角色名');
    expect(document.querySelector('.textbox-text')?.textContent).toBe('这是一段示例台词。');
  });

  it('新建按钮把新文本框加进列表并选中它', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByText('＋ 新建文本框'));
    const next = lastProject(onChange);
    expect(next.textBoxes).toHaveLength(2);
    expect(next.textBoxes?.[1].name).toBe('文本框 2');
    expect(next.ui?.textBoxUid).toBe(next.textBoxes?.[1].uid);
  });

  it('勾掉「显示说话人名字」写回 showName=false', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByLabelText('显示说话人名字'));
    expect(lastProject(onChange).textBoxes?.[0].showName).toBe(false);
  });

  it('改名称、示例台词、对齐、行距都写回项目', () => {
    const { onChange } = renderEditor();

    fireEvent.change(screen.getByDisplayValue('文本框 1'), { target: { value: '旁白框' } });
    expect(lastProject(onChange).textBoxes?.[0].name).toBe('旁白框');

    fireEvent.change(screen.getByDisplayValue('这是一段示例台词。'), {
      target: { value: '新的示例。' },
    });
    expect(lastProject(onChange).textBoxes?.[0].sampleText).toBe('新的示例。');

    fireEvent.click(screen.getByText('居中'));
    expect(lastProject(onChange).textBoxes?.[0].align).toBe('center');

    const lineHeight = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(lineHeight, { target: { value: '2' } });
    expect(lastProject(onChange).textBoxes?.[0].lineHeight).toBe(2);
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
