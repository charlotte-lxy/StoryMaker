// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildFolderTree, FolderTreeDialog } from './FolderTreeDialog';
import { folderOfPrefix, prefixFromFolder } from './ImportSettingsPage';

afterEach(cleanup);

describe('文件夹树', () => {
  it('把扁平路径挂成树，父目录排在子目录前面', () => {
    const tree = buildFolderTree([
      '/Game/GameContent/BP/Weapon/',
      '/Game/GameContent',
      '/Game/GameContent/BP',
    ]);

    expect(tree.path).toBe('/Game');
    expect(tree.children.map((node) => node.path)).toEqual(['/Game/GameContent']);
    const bp = tree.children[0].children[0];
    expect(bp.path).toBe('/Game/GameContent/BP');
    expect(bp.children.map((node) => node.path)).toEqual(['/Game/GameContent/BP/Weapon']);
  });

  it('没有上级的路径挂在根上，重复路径只出现一次', () => {
    const tree = buildFolderTree(['/Game/Sounds', '/Game/Sounds/', '/Game/Other']);
    expect(tree.children.map((node) => node.path)).toEqual(['/Game/Other', '/Game/Sounds']);
  });
});

describe('前缀与文件夹互转', () => {
  it('选中的文件夹拼成前缀，结尾带斜杠', () => {
    expect(prefixFromFolder('/Game/GameContent/BP/GAS/GA')).toBe(
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/GA/",
    );
    // 已经有结尾斜杠的不重复加
    expect(prefixFromFolder('/Game/BP/GA/')).toBe(
      "/Script/Engine.BlueprintGeneratedClass'/Game/BP/GA/",
    );
    expect(prefixFromFolder('  ')).toBe('');
  });

  it('从已有前缀里抠回文件夹，用来默认选中', () => {
    expect(folderOfPrefix("/Script/Engine.BlueprintGeneratedClass'/Game/BP/GA/")).toBe('/Game/BP/GA');
    expect(folderOfPrefix('')).toBe('');
  });
});

describe('目录树弹窗', () => {
  it('默认选中传进来的文件夹，点另一个再确认', () => {
    const onPick = vi.fn();
    render(
      <FolderTreeDialog
        folders={['/Game/A', '/Game/B']}
        initialPath="/Game/A"
        onPick={onPick}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByText('当前选择：/Game/A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByText('当前选择：/Game/B')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '用这个文件夹' }));
    expect(onPick).toHaveBeenCalledWith('/Game/B');
  });

  it('没选任何文件夹时确认按钮不可点', () => {
    render(
      <FolderTreeDialog
        folders={['/Game/A']}
        onPick={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(
      (screen.getByRole('button', { name: '用这个文件夹' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
