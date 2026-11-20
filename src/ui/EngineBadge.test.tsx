// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GodotEditorInfo, UnrealNodeInfo } from '../core/host';
import { EngineBadge } from './EngineBadge';
import type { GodotConnection } from './use-godot-connection';
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

const EDITOR: GodotEditorInfo = {
  pluginVersion: '0.1.0',
  projectName: 'MoonCocoon-Rose',
  projectPath: 'E:/Godot Project/MoonCocoon-Rose/MCRose/',
  engineVersion: '4.7.2-stable',
  pid: 35036,
};

function makeUnreal(overrides: Partial<UnrealConnection> = {}): UnrealConnection {
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

function makeGodot(overrides: Partial<GodotConnection> = {}): GodotConnection {
  return {
    available: true,
    status: 'idle',
    editor: null,
    message: '',
    plugin: null,
    installing: false,
    notice: null,
    connect: vi.fn(async () => undefined),
    installPlugin: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderBadge(engine: 'unreal' | 'godot', overrides: {
  unreal?: Partial<UnrealConnection>;
  godot?: Partial<GodotConnection>;
  onExportToUe?: () => void;
  onOpenSettings?: () => void;
}) {
  const onExportToUe = overrides.onExportToUe ?? vi.fn();
  const onOpenSettings = overrides.onOpenSettings ?? vi.fn();
  render(
    <EngineBadge
      engine={engine}
      connection={makeUnreal(overrides.unreal)}
      godotConnection={makeGodot(overrides.godot)}
      onExportToUe={onExportToUe}
      onOpenSettings={onOpenSettings}
    />,
  );
  return { onExportToUe, onOpenSettings };
}

describe('顶部编辑器状态标签', () => {
  it('选 Unreal 时还是原来那个 UE 标签，连上点一下导出', () => {
    const onExportToUe = vi.fn();
    renderBadge('unreal', {
      unreal: { status: 'online', node: NODE },
      onExportToUe,
    });

    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.textContent).toBe('UE');
    expect(badge.classList.contains('on')).toBe(true);
    fireEvent.click(badge);
    expect(onExportToUe).toHaveBeenCalledOnce();
  });

  it('选 Godot 时文字变 Godot，带工程名与引擎版本', () => {
    renderBadge('godot', { godot: { status: 'online', editor: EDITOR } });

    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.textContent).toBe('Godot');
    expect(badge.classList.contains('on')).toBe(true);
    expect(badge.getAttribute('title')).toContain('MoonCocoon-Rose');
    expect(badge.getAttribute('title')).toContain('4.7.2-stable');
  });

  it('选 Godot 时连不上是灰点，title 里带原因', () => {
    renderBadge('godot', {
      godot: { status: 'offline', message: '端口没人监听：Godot 编辑器没开，或插件没启用。' },
    });

    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.classList.contains('off')).toBe(true);
    expect(badge.getAttribute('title')).toContain('端口没人监听');
  });

  it('选 Godot 时点一下只去设置页，不让导出', () => {
    const { onExportToUe, onOpenSettings } = renderBadge('godot', {
      godot: { status: 'online', editor: EDITOR },
    });

    fireEvent.click(document.querySelector('.ue-badge') as HTMLElement);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onExportToUe).not.toHaveBeenCalled();
  });

  it('网页版没有能力时显示成灰色 off', () => {
    renderBadge('godot', { godot: { available: false } });
    const badge = document.querySelector('.ue-badge') as HTMLElement;
    expect(badge.classList.contains('off')).toBe(true);
    expect(badge.getAttribute('title')).toContain('只有桌面版');
  });
});
