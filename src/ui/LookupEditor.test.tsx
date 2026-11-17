// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LookupRow, Project } from '../core/types';
import { createEmptyProject } from '../state/operations';
import { LookupRowsTable } from './LookupEditor';
import type { AssetLibrary } from './use-asset-library';

afterEach(cleanup);

function makeProject(): Project {
  const project = createEmptyProject();
  project.imageCategories = [
    { uid: 'cat', name: '对话背景', path: '/Game/GameContent/Asset/Image/StoryBackground' },
  ];
  project.images = [{ uid: 'img-1', id: 'SCE_Black', name: '黑', categoryUid: 'cat' }];
  return project;
}

function makeLibrary(): AssetLibrary {
  return {
    available: true,
    folder: 'C:\\素材',
    loading: false,
    error: '',
    byId: new Map(),
    refresh: () => undefined,
    upload: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    rename: vi.fn(async () => ({ ok: true })),
  };
}

/** 包一层让它真的能改：受控输入要靠状态回写 */
function Harness({ onRenameAsset }: { onRenameAsset: (uid: string, oldId: string, newId: string, kind: 'image' | 'sound') => void }) {
  const [project, setProject] = useState(makeProject);

  return (
    <LookupRowsTable
      kind="images"
      project={project}
      rows={project.images}
      column="图片分类"
      categoryKind="imageCategories"
      onUpdate={(kind, uid, patch) =>
        setProject((prev) => ({
          ...prev,
          [kind]: (prev[kind] as LookupRow[]).map((row) =>
            row.uid === uid ? { ...row, ...patch } : row,
          ),
        }))
      }
      onRemove={() => undefined}
      onReorder={() => undefined}
      assets={{ library: makeLibrary(), host: undefined }}
      onRenameAsset={onRenameAsset}
    />
  );
}

describe('条目 ID 改名带动素材改名', () => {
  it('聚焦后改 ID 再离开，通知上层把素材文件跟着改名', () => {
    const onRenameAsset = vi.fn();
    render(<Harness onRenameAsset={onRenameAsset} />);

    const input = screen.getByDisplayValue('SCE_Black') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'SCE_New' } });
    fireEvent.blur(input);

    expect(onRenameAsset).toHaveBeenCalledWith('img-1', 'SCE_Black', 'SCE_New', 'image');
  });

  it('聚焦进来又原样出去，不触发改名', () => {
    const onRenameAsset = vi.fn();
    render(<Harness onRenameAsset={onRenameAsset} />);

    const input = screen.getByDisplayValue('SCE_Black') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onRenameAsset).not.toHaveBeenCalled();
  });

  it('把 ID 清空不触发改名（拼不出素材名）', () => {
    const onRenameAsset = vi.fn();
    render(<Harness onRenameAsset={onRenameAsset} />);

    const input = screen.getByDisplayValue('SCE_Black') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);

    expect(onRenameAsset).not.toHaveBeenCalled();
  });
});
