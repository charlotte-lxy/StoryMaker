// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '../core/types';
import { createEmptyProject } from '../state/operations';
import { FontEditor } from './FontEditor';
import type { AssetLibrary } from './use-asset-library';

afterEach(cleanup);

function makeLibrary(uploadResult: { ok: boolean; message?: string; filePath?: string }): {
  library: AssetLibrary;
  upload: ReturnType<typeof vi.fn>;
} {
  const upload = vi.fn(async () => uploadResult);
  return {
    upload,
    library: {
      available: true,
      folder: 'C:\\StoryMakerData\\Asset',
      loading: false,
      error: '',
      byId: new Map(),
      refresh: () => undefined,
      upload,
      remove: vi.fn(async () => ({ ok: true })),
      rename: vi.fn(async () => ({ ok: true })),
    },
  };
}

function renderEditor(project: Project, library: AssetLibrary | undefined) {
  const onChange = vi.fn();
  render(
    <FontEditor
      project={project}
      assets={library === undefined ? undefined : { library, host: undefined }}
      onChange={onChange}
    />,
  );
  return { onChange };
}

/** 取最后一次 onChange 的项目 */
function lastProject(onChange: ReturnType<typeof vi.fn>): Project {
  return onChange.mock.calls.at(-1)?.[0] as Project;
}

describe('字体子模块', () => {
  it('还没有字体时给一句提示', () => {
    renderEditor(createEmptyProject(), makeLibrary({ ok: true }).library);
    expect(screen.getByText(/还没有字体/)).toBeTruthy();
  });

  it('导入字体后按原文件名记一行，并顺手取个显示名称', async () => {
    const { library, upload } = makeLibrary({
      ok: true,
      filePath: 'C:\\StoryMakerData\\Asset\\Fonts\\思源黑体-Regular.ttf',
    });
    const { onChange } = renderEditor(createEmptyProject(), library);

    fireEvent.click(screen.getByText('＋ 导入字体'));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(upload).toHaveBeenCalledWith('', 'font', false);
    const next = lastProject(onChange);
    expect(next.fonts).toHaveLength(1);
    expect(next.fonts[0]).toMatchObject({
      name: '思源黑体-Regular',
      fileName: '思源黑体-Regular.ttf',
    });
  });

  it('改显示名称会写回项目', () => {
    const project = createEmptyProject();
    project.fonts = [{ uid: 'font-1', name: '思源黑体', fileName: '思源黑体-Regular.ttf' }];
    const { onChange } = renderEditor(project, makeLibrary({ ok: true }).library);

    fireEvent.change(screen.getByLabelText('字体显示名称 思源黑体-Regular.ttf'), {
      target: { value: '正文黑体' },
    });

    expect(lastProject(onChange).fonts[0]?.name).toBe('正文黑体');
  });

  it('删除字体就把那一行去掉', () => {
    const project = createEmptyProject();
    project.fonts = [
      { uid: 'font-1', name: '思源黑体', fileName: 'a.ttf' },
      { uid: 'font-2', name: '宋体标题', fileName: 'b.ttf' },
    ];
    const { onChange } = renderEditor(project, makeLibrary({ ok: true }).library);

    fireEvent.click(screen.getAllByText('删除')[0]);

    const next = lastProject(onChange);
    expect(next.fonts.map((row) => row.uid)).toEqual(['font-2']);
  });

  it('网页版（没有宿主）点导入只提示，不写项目', async () => {
    const { onChange } = renderEditor(createEmptyProject(), undefined);

    fireEvent.click(screen.getByText('＋ 导入字体'));

    expect(await screen.findByText('网页版不能导入字体文件，请在桌面版里操作')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
