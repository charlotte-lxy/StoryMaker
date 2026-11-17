// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnrealNodeInfo } from '../core/host';
import { UnrealBadge } from './UnrealBadge';
import type { UnrealConnection } from './use-unreal-connection';

afterEach(cleanup);

const NODE: UnrealNodeInfo = {
  id: 'UE1',
  user: 'A',
  machine: 'PC',
  engineVersion: '5.6.1',
  engineRoot: '',
  projectRoot: '',
  projectName: 'BulletShootGame',
};

function makeConnection(overrides: Partial<UnrealConnection> = {}): UnrealConnection {
  return {
    available: true,
    status: 'idle',
    node: null,
    message: '',
    catalog: null,
    catalogLoading: false,
    catalogError: '',
    connect: vi.fn(async () => undefined),
    refreshCatalog: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('顶部 UE 状态标签', () => {
  it('连上时是绿色的 on，带项目名和引擎版本', () => {
    render(<UnrealBadge connection={makeConnection({ status: 'online', node: NODE })} onOpenSettings={() => undefined} />);

    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.classList.contains('on')).toBe(true);
    expect(badge.textContent).toBe('UE');
    expect(badge.getAttribute('title')).toContain('BulletShootGame');
    expect(badge.getAttribute('title')).toContain('5.6.1');
  });

  it('没连上时是灰色的 off，并带上原因', () => {
    render(
      <UnrealBadge
        connection={makeConnection({ status: 'offline', message: '没发现在线编辑器' })}
        onOpenSettings={() => undefined}
      />,
    );

    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.classList.contains('off')).toBe(true);
    expect(badge.getAttribute('title')).toContain('没发现在线编辑器');
  });

  it('正在检测时是黄色的 wait', () => {
    render(<UnrealBadge connection={makeConnection({ status: 'checking' })} onOpenSettings={() => undefined} />);
    expect(document.querySelector('.ue-badge.wait')).toBeTruthy();
  });

  it('点一下跳到设置页', () => {
    const onOpenSettings = vi.fn();
    render(<UnrealBadge connection={makeConnection()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(document.querySelector('.ue-badge') as HTMLElement);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
