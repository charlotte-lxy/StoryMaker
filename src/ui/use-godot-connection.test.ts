// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GodotApi, GodotEditorInfo, GodotPluginState, HostApi } from '../core/host';
import { useGodotConnection } from './use-godot-connection';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const EDITOR: GodotEditorInfo = {
  pluginVersion: '0.1.0',
  projectName: 'MoonCocoon-Rose',
  projectPath: 'E:/Godot Project/MoonCocoon-Rose/MCRose/',
  engineVersion: '4.7.2-stable',
  pid: 35036,
};

const PROJECT = 'E:/Godot Project/MoonCocoon-Rose/MCRose/project.godot';

const PLUGIN: GodotPluginState = {
  ok: true,
  projectDir: 'E:/Godot Project/MoonCocoon-Rose/MCRose',
  installed: true,
  enabled: true,
  version: '0.1.0',
  pairing: true,
};

function makeGodot(overrides: Partial<GodotApi> = {}): GodotApi {
  return {
    pickProject: vi.fn(async () => null),
    pluginState: vi.fn(async () => PLUGIN),
    installPlugin: vi.fn(async () => ({ ok: true, message: '插件已安装。重启 Godot 编辑器后，再来点「检测连接」。' })),
    ping: vi.fn(async () => ({ ok: true, editor: EDITOR })),
    ...overrides,
  };
}

function makeHost(godot: GodotApi | undefined): HostApi {
  return { kind: 'desktop', godot } as unknown as HostApi;
}

describe('自动连接', () => {
  it('关着的时候不会自己探测', async () => {
    vi.useFakeTimers();
    const godot = makeGodot();
    renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: false, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(godot.ping).not.toHaveBeenCalled();
  });

  it('开着时立刻探一次，之后按间隔继续探', async () => {
    vi.useFakeTimers();
    const godot = makeGodot();
    renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: true, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(godot.ping).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(godot.ping).toHaveBeenCalledTimes(2);

    // 探测用短超时，别每次卡好几秒
    const firstCall = (godot.ping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[1]).toBeLessThan(3000);
  });

  it('没选工程时不探测', async () => {
    vi.useFakeTimers();
    const godot = makeGodot();
    renderHook(() =>
      useGodotConnection(makeHost(godot), '  ', { autoConnect: true, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(godot.ping).not.toHaveBeenCalled();
  });
});

describe('连接与插件', () => {
  it('探测到编辑器后状态变 online，并带上工程信息', async () => {
    const godot = makeGodot();
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: true, intervalSec: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.editor?.projectName).toBe('MoonCocoon-Rose');
    expect(result.current.editor?.engineVersion).toBe('4.7.2-stable');
  });

  it('ping 失败就标成 offline，并把插件没装的原因写进 message', async () => {
    const godot = makeGodot({
      ping: vi.fn(async () => ({
        ok: false,
        message: '没找到配对文件：插件还没装，或者装完没重启 Godot 编辑器。',
      })),
    });
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: false }),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('offline');
    expect(result.current.message).toContain('没找到配对文件');
    expect(result.current.notice?.ok).toBe(false);
  });

  it('手动检测成功会写一条 notice，供设置页内联显示', async () => {
    const godot = makeGodot();
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: false }),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('online');
    expect(result.current.notice).toEqual({ ok: true, text: '已连上 MoonCocoon-Rose' });
  });

  it('进页面就读一次插件状态，装完插件再读一次', async () => {
    const godot = makeGodot({
      pluginState: vi
        .fn()
        .mockResolvedValueOnce({ ...PLUGIN, installed: false, enabled: false, pairing: false })
        .mockResolvedValue(PLUGIN),
    });
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(godot), PROJECT, { autoConnect: false }),
    );

    await waitFor(() => expect(result.current.plugin?.installed).toBe(false));

    await act(async () => {
      await result.current.installPlugin();
    });
    expect(godot.installPlugin).toHaveBeenCalledWith(PROJECT);
    expect(result.current.plugin?.installed).toBe(true);
    expect(result.current.installing).toBe(false);
    expect(result.current.notice?.ok).toBe(true);
    expect(result.current.notice?.text).toContain('插件已安装');
  });

  it('没选工程时点安装不会去动磁盘', async () => {
    const godot = makeGodot();
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(godot), '', { autoConnect: false }),
    );

    await act(async () => {
      await result.current.installPlugin();
    });
    expect(godot.installPlugin).not.toHaveBeenCalled();
  });

  it('没有 godot 能力时 available 为 false（网页版）', () => {
    const { result } = renderHook(() =>
      useGodotConnection(makeHost(undefined), PROJECT, { autoConnect: true }),
    );
    expect(result.current.available).toBe(false);
    expect(result.current.plugin).toBeNull();
  });
});
