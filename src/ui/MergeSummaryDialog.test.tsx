// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Patch } from '../core/collab/protocol';
import type { Project } from '../core/types';
import { MergeSummaryDialog } from './MergeSummaryDialog';

afterEach(() => {
  cleanup();
});

function makeProject(): Project {
  return {
    version: 1,
    name: '测试项目',
    characters: [{ uid: 'c1', id: 'CHA_甲', name: '甲', playPosition: '剧情对话框', nameEn: '', nameJa: '', aliases: [], expressions: [], actions: [] }],
    items: [],
    quests: [],
    images: [],
    sounds: [],
    commands: [],
    chapters: [{ uid: 'ch1', id: 'ch01', title: '第一章', groups: [] }],
    variables: [],
    uiTexts: [],
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

describe('MergeSummaryDialog', () => {
  it('把对方带来的改动列成清单：位置、类型、内容', () => {
    const patches: Patch[] = [
      { kind: 'field', target: 'characters/c1', field: 'name', oldValue: '甲', value: '乙' },
      { kind: 'add', collection: 'chapters', item: { uid: 'ch9', id: 'ch09', title: '新章节' } },
      { kind: 'remove', target: 'chapters/ch1', oldValue: { uid: 'ch1' } },
    ];

    render(<MergeSummaryDialog project={makeProject()} patches={patches} onClose={() => {}} />);

    // 表头文本被拆成了几个节点，直接看 textContent
    const header = screen.getByRole('dialog').querySelector('header');
    expect(header?.textContent).toContain('3 处改动');

    expect(screen.getByText('位置')).toBeTruthy();
    expect(screen.getByText('类型')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();

    expect(screen.getByText('甲 · 名称')).toBeTruthy();
    expect(screen.getByText('甲 → 乙')).toBeTruthy();

    expect(screen.getByText('新增')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
    expect(screen.getByText('「新章节」')).toBeTruthy();
  });

  it('点「知道了」就走人', () => {
    const onClose = vi.fn();
    render(
      <MergeSummaryDialog
        project={makeProject()}
        patches={[{ kind: 'add', collection: 'chapters', item: { uid: 'chX', title: 'X' } }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(onClose).toHaveBeenCalled();
  });
});
