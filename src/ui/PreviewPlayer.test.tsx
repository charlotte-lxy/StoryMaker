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
  } = {},
) {
  const project = options.project ?? makeProject();
  const onPickStart = options.onPickStart ?? vi.fn();
  const onCollapse = options.onCollapse ?? vi.fn();
  const view = render(
    <PreviewPlayer
      project={project}
      start={options.start === undefined ? { groupUid: 'g1' } : options.start}
      activeGroupUid={options.activeGroupUid ?? 'g1'}
      assets={{ library: emptyLibrary(), host: undefined }}
      onPickStart={onPickStart}
      onCollapse={onCollapse}
    />,
  );
  return { ...view, project, onPickStart, onCollapse };
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

  it('起点下拉换段落会通知 App', () => {
    const { onPickStart } = renderPlayer();
    const select = screen.getByTitle('预览从哪个段落开始') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'g2' } });
    expect(onPickStart).toHaveBeenCalledWith('g2');
  });

  it('起点下拉可以指定从哪一行开始', () => {
    const { onPickStart } = renderPlayer();
    const select = screen.getByTitle('从这一行开始（默认第一行）') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'd2' } });
    expect(onPickStart).toHaveBeenCalledWith('g1', 'd2');
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
    expect(container.querySelector('.preview-hint')?.textContent).toContain('素材文件夹');
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
    fireEvent.click(screen.getByTitle('收起预览面板，给对话列表让出地方'));
    expect(onCollapse).toHaveBeenCalled();
  });

  it('面板聚焦时空格继续、Esc 收起', () => {
    const { container, onCollapse } = renderPlayer();
    const panel = screen.getByLabelText('剧情预览');

    fireEvent.keyDown(panel, { key: ' ' });
    expect(container.querySelector('.preview-text')?.textContent).toBe('第二句');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onCollapse).toHaveBeenCalled();
  });

  it('下拉框里的键盘操作不会被面板抢走', () => {
    const { container } = renderPlayer();
    const select = screen.getByTitle('预览从哪个段落开始');
    fireEvent.keyDown(select, { key: ' ' });
    // 还在第一句，没有被「继续」推进
    expect(container.querySelector('.preview-text')?.textContent).toBe('第一句');
  });
});
