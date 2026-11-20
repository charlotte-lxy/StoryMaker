// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Line, Project, StoryOption } from '../core/types';
import { createEmptyProject } from '../state/operations';
import { PreviewPlayer } from './PreviewPlayer';
import type { AssetLibrary } from './use-asset-library';

afterEach(() => {
  cleanup();
});

/** 什么都没配的素材库：预览走占位，不读文件 */
function emptyLibrary(): AssetLibrary {
  return {
    available: false,
    folder: '',
    loading: false,
    error: '',
    byId: new Map(),
    refresh: () => undefined,
    upload: async () => ({ ok: false }),
    remove: async () => ({ ok: false }),
    rename: async () => ({ ok: false }),
  };
}

function dialogue(uid: string, readableId: string, zh: string, patch: Partial<Line> = {}): Line {
  return {
    uid,
    readableId,
    kind: '对话',
    characterUid: '',
    displayAliasUid: '',
    text: { zh, en: '', ja: '' },
    autoAdvance: false,
    command: '',
    specialContent: null,
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
    ...patch,
  };
}

function optionLine(uid: string, readableId: string, optionIds: string[]): Line {
  return dialogue(uid, readableId, '', { kind: '选项', optionIds });
}

function option(uid: string, readableId: string, zh: string, nextId: string): StoryOption {
  return {
    uid,
    readableId,
    text: { zh, en: '', ja: '' },
    nextId,
    appearConditions: [],
    enableConditions: [],
  };
}

function makeProject(): Project {
  const project = createEmptyProject('预览界面测试');
  project.characters.push({
    uid: 'cha1',
    id: 'CHA_雪',
    name: '西园寺雪',
    nameEn: '',
    nameJa: '',
    playPosition: project.playPositions[0]?.uid ?? '',
    aliases: [],
    expressions: [],
    actions: [],
  });
  project.chapters = [
    {
      uid: 'c1',
      id: 'ch01',
      title: '序章',
      groups: [
        {
          uid: 'g1',
          id: '001',
          title: '开场',
          note: '',
          lines: [
            dialogue('l0', 'Dia_ch01_001-1', '', {
              kind: '指令',
              command: '剧情|演出|角色:cha1;立绘位移:进入',
            }),
            dialogue('d1', 'Dia_ch01_001-2', '第一句', { characterUid: 'cha1' }),
            dialogue('d2', 'Dia_ch01_001-3', '第二句'),
          ],
          options: [],
        },
        {
          uid: 'g2',
          id: '002',
          title: '码头',
          note: '',
          lines: [dialogue('d3', 'Dia_ch01_002-1', '海风很大')],
          options: [],
        },
      ],
    },
  ];
  return project;
}

function renderPlayer(
  options: {
    project?: Project;
    start?: { groupUid: string; lineUid?: string } | null;
    activeGroupUid?: string;
    onPickStart?: (groupUid: string, lineUid?: string) => void;
    onCollapse?: () => void;
    onStop?: () => void;
    locked?: boolean;
    onToggleLocked?: (locked: boolean) => void;
    onActiveLine?: (lineUid: string, groupUid: string) => void;
  } = {},
) {
  const project = options.project ?? makeProject();
  const onPickStart = options.onPickStart ?? vi.fn();
  const onCollapse = options.onCollapse ?? vi.fn();
  const onStop = options.onStop ?? vi.fn();
  const onToggleLocked = options.onToggleLocked ?? vi.fn();
  const onActiveLine = options.onActiveLine ?? vi.fn();
  const view = render(
    <PreviewPlayer
      project={project}
      start={options.start === undefined ? { groupUid: 'g1' } : options.start}
      activeGroupUid={options.activeGroupUid ?? 'g1'}
      assets={{ library: emptyLibrary(), host: undefined }}
      onPickStart={onPickStart}
      onCollapse={onCollapse}
      onStop={onStop}
      locked={options.locked ?? true}
      onToggleLocked={onToggleLocked}
      onActiveLine={onActiveLine}
    />,
  );
  return {
    ...view,
    project,
    onPickStart,
    onCollapse,
    onStop,
    onToggleLocked,
    onActiveLine,
  };
}

describe('PreviewPlayer 空态与入口', () => {
  it('没有起点时显示空态，可以从当前段落开始', () => {
    const { onPickStart } = renderPlayer({ start: null, activeGroupUid: 'g2' });

    expect(screen.getByText('还没有开始预览。')).toBeTruthy();
    fireEvent.click(screen.getByText('▶ 从当前段落开始'));
    expect(onPickStart).toHaveBeenCalledWith('g2');
  });

  it('当前没有段落时「从当前段落开始」禁用', () => {
    renderPlayer({ start: null, activeGroupUid: '' });
    expect((screen.getByText('▶ 从当前段落开始') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PreviewPlayer 播放', () => {
  it('逐条显示台词与说话人，点继续往下走', () => {
    const { container } = renderPlayer();

    expect(container.querySelector('.preview-text')?.textContent).toBe('第一句');
    expect(container.querySelector('.preview-speaker')?.textContent).toBe('西园寺雪');

    fireEvent.click(screen.getByText('继续 ▶'));
    expect(container.querySelector('.preview-text')?.textContent).toBe('第二句');
  });

  it('台词念完显示本段结束，并给出继续下一段', () => {
    const { container } = renderPlayer();

    fireEvent.click(screen.getByText('继续 ▶'));
    fireEvent.click(screen.getByText('继续 ▶'));

    expect(container.querySelector('.preview-finished')?.textContent).toBe('本段结束');
    expect((screen.getByText('继续下一段 ▶') as HTMLButtonElement).disabled).toBe(false);
  });

  it('没有素材时画占位，并提示要桌面版 + 素材文件夹', () => {
    const { container } = renderPlayer();

    expect(container.querySelector('.preview-character-placeholder')).not.toBeNull();
    expect(container.querySelector('.preview-character-placeholder')?.textContent).toContain(
      '西园寺雪',
    );
    expect(container.querySelector('.preview-footer')?.textContent).toContain('素材文件夹');
  });

  it('上一句退回上一句台词', () => {
    const { container } = renderPlayer();

    fireEvent.click(screen.getByText('继续 ▶'));
    fireEvent.click(screen.getByText('◀ 上一句'));
    expect(container.querySelector('.preview-text')?.textContent).toBe('第一句');
  });
});

describe('PreviewPlayer 选项', () => {
  it('摆出选项与条件小字，点了按目标跳转', () => {
    const project = makeProject();
    project.chapters[0].groups[0].lines = [
      optionLine('l1', 'Dia_ch01_001-1', ['o1']),
      dialogue('d2', 'Dia_ch01_001-2', '接着说'),
    ];
    project.chapters[0].groups[0].options = [
      {
        ...option('o1', 'Dia_ch01_001-1A', '去码头', 'd3'),
        appearConditions: ['背包||物品:Item_Coin;运算符:>=;数量:10'],
      },
    ];

    const { container } = renderPlayer({ project });

    const buttons = [...container.querySelectorAll('.preview-option')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('去码头');
    expect(buttons[0].textContent).toContain('出现：背包');

    fireEvent.click(buttons[0]);
    expect(container.querySelector('.preview-text')?.textContent).toBe('海风很大');
  });
});

describe('PreviewPlayer 键盘与收起', () => {
  it('点收起按钮通知 App', () => {
    const { onCollapse } = renderPlayer();
    fireEvent.click(screen.getByTitle('收起预览面板，把地方让给流程图'));
    expect(onCollapse).toHaveBeenCalled();
  });

  it('点「结束预览」：通知 App 并回到空态', () => {
    const { onStop, container } = renderPlayer();

    fireEvent.click(screen.getByRole('button', { name: '结束预览' }));
    expect(onStop).toHaveBeenCalled();
    expect(container.querySelector('.preview-text')).toBeNull();
    expect(screen.getByText('还没有开始预览。')).toBeTruthy();
  });

  it('面板聚焦时空格继续、Esc 收起', () => {
    const { container, onCollapse } = renderPlayer();
    const panel = screen.getByLabelText('剧情预览');

    fireEvent.keyDown(panel, { key: ' ' });
    expect(container.querySelector('.preview-text')?.textContent).toBe('第二句');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onCollapse).toHaveBeenCalled();
  });

  it('按钮里的键盘操作不会被面板抢走', () => {
    const { container } = renderPlayer();
    const button = screen.getByRole('button', { name: '继续 ▶' });
    fireEvent.keyDown(button, { key: ' ' });
    // 还在第一句，没有被面板的「继续」再推进一次
    expect(container.querySelector('.preview-text')?.textContent).toBe('第一句');
  });
});

describe('PreviewPlayer 锁定到对话', () => {
  it('默认勾上，点一下通知 App', () => {
    const { onToggleLocked } = renderPlayer();
    const box = screen.getByRole('checkbox', { name: '锁定到对话' }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(onToggleLocked).toHaveBeenCalledWith(false);
  });

  it('播放停到某一行时把行号 / 段落报给 App（供高亮与滚动）', () => {
    const onActiveLine = vi.fn();
    const { container } = renderPlayer({ onActiveLine });

    expect(onActiveLine).toHaveBeenCalledWith('d1', 'g1');
    expect(container.querySelector('.preview-text')?.textContent).toBe('第一句');

    fireEvent.click(screen.getByText('继续 ▶'));
    expect(onActiveLine).toHaveBeenLastCalledWith('d2', 'g1');
  });
});
