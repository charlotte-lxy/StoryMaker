// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collaborator } from '../core/collab/presence';
import { CollabBadge } from './CollabBadge';

afterEach(() => {
  cleanup();
});

const me: Collaborator = { clientId: 'me', name: '小王', color: 'red', module: 'story', lastSeen: 0 };
const other: Collaborator = {
  clientId: 'other',
  name: '小李',
  color: 'blue',
  module: 'battle',
  lastSeen: 0,
};

function renderBadge(overrides: Partial<Parameters<typeof CollabBadge>[0]> = {}) {
  const props = {
    status: 'online' as const,
    detail: 'ws://127.0.0.1:1999',
    url: 'ws://127.0.0.1:1999',
    collaborators: [me, other],
    myName: '小王',
    myColor: 'red' as const,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onRename: vi.fn(),
    onRecolor: vi.fn(),
    ...overrides,
  };
  render(<CollabBadge {...props} />);
  return props;
}

describe('CollabBadge', () => {
  it('按钮上直接显示在线人数', () => {
    renderBadge();

    expect(screen.getByRole('button', { name: /协作 2/ })).toBeTruthy();
  });

  it('离线时不报人数（那会儿只有自己，「1 人协作」没意义）', () => {
    renderBadge({ status: 'offline', collaborators: [me] });

    expect(screen.getByRole('button', { name: '协作' })).toBeTruthy();
  });

  it('点开面板：名字输入框、七个颜色、成员名单都在', () => {
    renderBadge();
    fireEvent.click(screen.getByRole('button', { name: /协作/ }));

    expect(screen.getByPlaceholderText('未命名用户')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /^(红|橙|黄|绿|青|蓝|紫)$/ }),
    ).toHaveLength(7);

    expect(screen.getByText('正在协作（2）')).toBeTruthy();
    expect(screen.getByText('小王')).toBeTruthy();
    expect(screen.getByText('小李')).toBeTruthy();
    expect(screen.getByText('（我）')).toBeTruthy();
  });

  it('改名字是改完之后才提交的，不是边打边广播', () => {
    const props = renderBadge();
    fireEvent.click(screen.getByRole('button', { name: /协作/ }));

    const input = screen.getByPlaceholderText('未命名用户');
    fireEvent.change(input, { target: { value: '新名字' } });
    expect(props.onRename).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(props.onRename).toHaveBeenCalledWith('新名字');
  });

  it('点哪个颜色就换成哪个', () => {
    const props = renderBadge();
    fireEvent.click(screen.getByRole('button', { name: /协作/ }));

    fireEvent.click(screen.getByRole('button', { name: '紫' }));
    expect(props.onRecolor).toHaveBeenCalledWith('purple');
  });

  it('没填名字的人显示「未命名用户」', () => {
    renderBadge({
      collaborators: [{ clientId: 'x', name: '', color: 'green', module: '', lastSeen: 0 }, me],
      myName: '',
    });
    fireEvent.click(screen.getByRole('button', { name: /协作/ }));

    expect(screen.getByText('未命名用户')).toBeTruthy();
  });
});
