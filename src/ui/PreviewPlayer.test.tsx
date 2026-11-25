// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultTextBox, createPortraitControl } from '../core/textbox';
import type { Line, Project, StoryOption, TextBoxControl } from '../core/types';
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

/** 第一个文本框里的台词控件：改出现效果 / 多行都落在它身上 */
function lineControlOf(project: Project): TextBoxControl {
  const found = project.textBoxes?.[0]?.controls.find(
    (control) => control.kind === 'text' && control.content === 'line',
  );
  if (found === undefined) throw new Error('没有台词控件');
  return found;
}

function makeProject(): Project {
  const project = createEmptyProject('预览界面测试');
  const boxUid = project.textBoxes[0]?.uid ?? '';
  project.characters.push({
    uid: 'cha1',
    id: 'CHA_雪',
    name: '西园寺雪',
    nameEn: 'Seienji Yuki',
    nameJa: '',
    textBoxUid: boxUid,
    aliases: [],
    expressions: [],
    actions: [],
  });
  // 立绘现在是文本框里的「立绘弹窗」控件，给这个框挂一个
  project.textBoxes[0]?.controls.push(createPortraitControl({ x: 0.3, y: 0.1, w: 0.4, h: 0.8 }));
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
            dialogue('d2', 'Dia_ch01_001-3', '第二句', { characterUid: 'cha1' }),
          ],
          options: [],
        },
        {
          uid: 'g2',
          id: '002',
          title: '码头',
          note: '',
          lines: [dialogue('d3', 'Dia_ch01_002-1', '海风很大', { characterUid: 'cha1' })],
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
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    onStop?: () => void;
    locked?: boolean;
    onToggleLocked?: (locked: boolean) => void;
    onActiveLine?: (lineUid: string, groupUid: string) => void;
  } = {},
) {
  const project = options.project ?? makeProject();
  const onPickStart = options.onPickStart ?? vi.fn();
  const onToggleCollapsed = options.onToggleCollapsed ?? vi.fn();
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
      collapsed={options.collapsed ?? false}
      onToggleCollapsed={onToggleCollapsed}
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
    onToggleCollapsed,
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

    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');
    expect(container.querySelector('.preview-textbox-text[data-content="speaker"]')?.textContent).toBe('西园寺雪');

    fireEvent.click(screen.getByText('继续 ▶'));
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第二句');
  });

  it('点画面就当点继续往下走', () => {
    const { container } = renderPlayer();

    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');

    fireEvent.click(container.querySelector('.preview-frame') as HTMLElement);
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第二句');
  });

  it('图片控件按自己的矩形摆，不会铺满整屏', () => {
    const { container } = renderPlayer();

    const image = container.querySelector('.preview-textbox-image') as HTMLElement;
    expect(image).toBeTruthy();
    // 0.05×1920 / 0.66×1080 / 0.9×1920 / 0.28×1080：少了 position 就会按父层铺满
    expect(image.style.position).toBe('absolute');
    expect(image.style.left).toBe('96px');
    expect(Math.round(Number.parseFloat(image.style.top))).toBe(713);
    expect(image.style.width).toBe('1728px');
    expect(Math.round(Number.parseFloat(image.style.height))).toBe(302);
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
    expect(container.querySelector('.preview-log-bar')?.textContent).toContain('素材文件夹');
  });

  it('上一句退回上一句台词', () => {
    const { container } = renderPlayer();

    fireEvent.click(screen.getByText('继续 ▶'));
    fireEvent.click(screen.getByText('◀ 上一句'));
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');
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
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('海风很大');
  });

  it('选项单独铺一层盖在画面中间（层级由样式压住立绘）', () => {
    const project = makeProject();
    project.chapters[0].groups[0].lines = [optionLine('l1', 'Dia_ch01_001-1', ['o1'])];
    project.chapters[0].groups[0].options = [option('o1', 'Dia_ch01_001-1A', '去码头', 'd3')];

    const { container } = renderPlayer({ project });
    const overlay = container.querySelector('.preview-options');
    expect(overlay).not.toBeNull();
    // 选项层挂在舞台画面里，不是堆在控制条下面
    expect(overlay?.parentElement?.className).toContain('preview-frame');
  });
});

describe('PreviewPlayer 语言与音量', () => {
  it('切到英文后台词、选项、说话人名字都走英文', () => {
    const project = makeProject();
    project.chapters[0].groups[0].lines = [
      dialogue('d1', 'Dia_ch01_001-1', '第一句', {
        characterUid: 'cha1',
        text: { zh: '第一句', en: 'First line', ja: '最初の台詞' },
      }),
      optionLine('l1', 'Dia_ch01_001-2', ['o1']),
    ];
    project.chapters[0].groups[0].options = [
      {
        ...option('o1', 'Dia_ch01_001-2A', '去码头', 'd3'),
        text: { zh: '去码头', en: 'Go to the dock', ja: '' },
      },
    ];
    project.characters[0].nameEn = 'Seienji Yuki';
    project.characters[0].nameJa = '西園寺ユキ';

    const { container } = renderPlayer({ project });

    const picker = screen.getByLabelText('预览语言') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'en' } });
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('First line');
    expect(container.querySelector('.preview-textbox-text[data-content="speaker"]')?.textContent).toBe('Seienji Yuki');

    // 推进到选项，选项文本也走英文
    fireEvent.click(screen.getByText('继续 ▶'));
    expect(container.querySelector('.preview-option-text')?.textContent).toBe('Go to the dock');

    fireEvent.change(picker, { target: { value: 'ja' } });
    expect(container.querySelector('.preview-option-text')?.textContent).toBe('去码头');
  });

  it('音量滑块默认 100%，拖到 0 后显示 0%', () => {
    renderPlayer();

    const slider = screen.getByLabelText('预览音量') as HTMLInputElement;
    expect(slider.value).toBe('100');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.value).toBe('0');
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('立绘弹窗默认单张，占的是控件那一格', () => {
    const { container } = renderPlayer();
    const row = container.querySelector('.preview-portrait-row');
    expect(row?.getAttribute('data-mode')).toBe('single');
    expect(row?.querySelectorAll('.preview-portrait')).toHaveLength(1);
  });
});

describe('PreviewPlayer 出现效果', () => {
  it('逐字：一句话一个字一个字露出来，点继续先补完整行，再点才推进', () => {
    vi.useFakeTimers();
    try {
      const project = makeProject();
      lineControlOf(project).reveal = 'typewriter';
      lineControlOf(project).typeSpeed = 10; // 每个字 100ms
      const { container } = renderPlayer({ project });
      const text = (): string => container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent ?? '';

      expect(text()).toBe('');
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(text()).toBe('第一');

      // 第一下只是把这一句补完，不推进剧情
      fireEvent.click(screen.getByText('继续 ▶'));
      expect(text()).toBe('第一句');

      fireEvent.click(screen.getByText('继续 ▶'));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(text()).toBe('第二句');
    } finally {
      vi.useRealTimers();
    }
  });

  it('台词允许多行：下一句接在下一行，不覆盖上一句', () => {
    const project = makeProject();
    lineControlOf(project).multiLine = true;
    const { container } = renderPlayer({ project });

    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');
    fireEvent.click(screen.getByText('继续 ▶'));
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句\n第二句');
  });

  it('层级高的文本框排在后面，压在其他框上面', () => {
    const project = makeProject();
    const second = createDefaultTextBox('叠加框', 'TB_2');
    second.layer = 5;
    project.textBoxes!.push(second);
    project.chapters[0].groups[0].lines.unshift(
      dialogue('l9', 'Dia_ch01_001-0', '', {
        kind: '指令',
        command: `剧情|文本框|文本框:${second.uid};操作:弹出`,
      }),
    );

    const { container } = renderPlayer({ project });
    const layers = [...container.querySelectorAll('.preview-textbox')] as HTMLElement[];
    expect(layers).toHaveLength(2);
    expect(layers[0].style.zIndex).toBe('0');
    expect(layers[1].style.zIndex).toBe('5');
  });
});

describe('PreviewPlayer 键盘与收起', () => {
  it('点收起按钮通知 App', () => {
    const { onToggleCollapsed } = renderPlayer();
    fireEvent.click(screen.getByTitle('收起预览面板，把地方让给流程图'));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it('收起时只留标题栏，标题栏里有展开按钮', () => {
    renderPlayer({ collapsed: true });

    expect(screen.getByText('剧情预览')).toBeTruthy();
    expect(screen.getByText('展开 ⏷')).toBeTruthy();
    // 结束预览、控制条这些都在收起时隐藏
    expect(screen.queryByText('结束预览')).toBeNull();
    expect(screen.queryByText('继续 ▶')).toBeNull();
  });

  it('点「结束预览」：通知 App 并回到空态', () => {
    const { onStop, container } = renderPlayer();

    fireEvent.click(screen.getByRole('button', { name: '结束预览' }));
    expect(onStop).toHaveBeenCalled();
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')).toBeNull();
    expect(screen.getByText('还没有开始预览。')).toBeTruthy();
  });

  it('面板聚焦时空格继续、Esc 收起', () => {
    const { container, onToggleCollapsed } = renderPlayer();
    const panel = screen.getByLabelText('剧情预览');

    fireEvent.keyDown(panel, { key: ' ' });
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第二句');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it('按钮里的键盘操作不会被面板抢走', () => {
    const { container } = renderPlayer();
    const button = screen.getByRole('button', { name: '继续 ▶' });
    fireEvent.keyDown(button, { key: ' ' });
    // 还在第一句，没有被面板的「继续」再推进一次
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');
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
    expect(container.querySelector('.preview-textbox-text[data-content="line"]')?.textContent).toBe('第一句');

    fireEvent.click(screen.getByText('继续 ▶'));
    expect(onActiveLine).toHaveBeenLastCalledWith('d2', 'g1');
  });
});
