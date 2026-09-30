// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Conflict } from '../core/collab/protocol';
import type { Project } from '../core/types';
import { ConflictPanel } from './ConflictPanel';

function makeProject(): Project {
  return {
    version: 1,
    name: '测试项目',
    characters: [{ uid: 'c1', id: 'CHA_甲', name: '甲', playPosition: '剧情对话框', expressions: [], actions: [] }],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    chapters: [{ uid: 'ch1', id: 'ch01', title: '第一章', groups: [] }],
    variables: [],
    uiTexts: [],
    nameTexts: [],
    battle: {
      skillClassPrefix: '',
      effectClassPrefix: '',
      attributes: [],
      effects: [],
      skills: [],
      events: [],
      characters: [],
      weapons: [],
    },
    exportSettings: [],
  };
}

function makeConflicts(): Conflict[] {
  return [
    {
      patch: {
        kind: 'field',
        target: 'characters/c1',
        field: 'name',
        oldValue: '甲',
        value: '对方改的名字',
      },
      localValue: '我改的名字',
      reason: 'both-changed',
    },
    {
      patch: {
        kind: 'field',
        target: 'chapters/ch1',
        field: 'title',
        oldValue: '第一章',
        value: '对方改的标题',
      },
      localValue: '我改的标题',
      reason: 'both-changed',
    },
  ];
}

function renderPanel(overrides: { onApply?: (choices: string[]) => void; onCancel?: () => void } = {}) {
  const onApply = overrides.onApply ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  render(
    <ConflictPanel
      project={makeProject()}
      conflicts={makeConflicts()}
      onApply={onApply as never}
      onCancel={onCancel}
    />,
  );
  return { onApply, onCancel };
}

afterEach(() => {
  cleanup();
});

describe('ConflictPanel', () => {
  it('摆成三列：位置、对方数据、己方数据', () => {
    renderPanel();

    expect(screen.getByText('位置')).toBeTruthy();
    expect(screen.getByText('对方数据')).toBeTruthy();
    expect(screen.getByText('己方数据')).toBeTruthy();
    expect(screen.getByText('对方改的名字')).toBeTruthy();
    expect(screen.getByText('我改的名字')).toBeTruthy();
  });

  it('位置列说的是人话（条目名 + 字段名），不是 uid 路径', () => {
    renderPanel();

    expect(screen.getByText('甲 · 名称')).toBeTruthy();
    expect(screen.getByText('第一章 · 标题')).toBeTruthy();
  });

  it('点某一列就选中它', () => {
    renderPanel();

    const theirs = screen.getAllByTitle('点这里采用对方的数据');
    expect(theirs[0].className).not.toContain('picked');

    fireEvent.click(theirs[0]);
    expect(theirs[0].className).toContain('picked');
    expect(theirs[1].className).not.toContain('picked');
  });

  it('还有没选的地方时，「确认合并」点不动', () => {
    renderPanel();

    const confirm = screen.getByRole('button', { name: '确认合并' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    for (const cell of screen.getAllByTitle('点这里采用对方的数据')) fireEvent.click(cell);
    expect(confirm.disabled).toBe(false);
  });

  it('「全部使用我方数据」要二次确认，确认后每一条都选了己方', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '全部使用我方数据' }));
    expect(screen.getByText('请确认')).toBeTruthy(); // 二次确认弹出来了

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    for (const cell of screen.getAllByTitle('点这里采用己方的数据')) {
      expect(cell.className).toContain('picked');
    }
  });

  it('「取消合并」也要二次确认，确认后才回调', () => {
    const { onCancel } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '取消合并并切换回离线模式' }));
    expect(onCancel).not.toHaveBeenCalled(); // 还没点确定

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('确认合并把逐条的选择原样传回去', () => {
    const onApply = vi.fn();
    renderPanel({ onApply });

    fireEvent.click(screen.getAllByTitle('点这里采用对方的数据')[0]);
    fireEvent.click(screen.getAllByTitle('点这里采用己方的数据')[1]);

    fireEvent.click(screen.getByRole('button', { name: '确认合并' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledWith(['theirs', 'mine']);
  });

  it('表头写着已选几条', () => {
    renderPanel();
    // 表头的文本被拆成了好几个节点，所以直接看 textContent
    const header = screen.getByRole('dialog').querySelector('header');

    expect(header?.textContent).toContain('0 / 2 已选');
    fireEvent.click(screen.getAllByTitle('点这里采用对方的数据')[0]);
    expect(header?.textContent).toContain('1 / 2 已选');
  });
});
