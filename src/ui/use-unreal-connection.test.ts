// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostApi, UnrealApi, UnrealNodeInfo } from '../core/host';
import { useUnrealConnection } from './use-unreal-connection';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NODE: UnrealNodeInfo = {
  id: 'UE1',
  user: 'A',
  machine: 'PC',
  engineVersion: '5.6.1',
  engineRoot: '',
  projectRoot: '',
  projectName: 'BulletShootGame',
};

const UPROJECT = 'E:/UE/BulletShootGame.uproject';

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [NODE] })),
    queryCatalog: vi.fn(async () => ({ ok: true, dataTables: [], folders: [] })),
    runImport: vi.fn(async () => ({
      ok: true,
      stopped: false,
      items: [],
      importedOwnerUids: [],
      counts: { tables: 0, images: 0, sounds: 0 },
    })),
    onImportProgress: vi.fn(() => () => undefined),
    pickUproject: vi.fn(async () => null),
    pickAssetFolder: vi.fn(async () => null),
    listAssets: vi.fn(async () => ({ ok: true, files: [] })),
    uploadAsset: vi.fn(async () => ({ ok: false, canceled: true })),
    removeAsset: vi.fn(async () => ({ ok: true })),
    renameAsset: vi.fn(async () => ({ ok: true })),
    readAsset: vi.fn(async () => ({ ok: true, data: new Uint8Array() })),
    writeAsset: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function makeHost(unreal: UnrealApi | undefined): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

describe('自动连接', () => {
  it('关着的时候不会自己探测', async () => {
    vi.useFakeTimers();
    const unreal = makeUnreal();
    renderHook(() =>
      useUnrealConnection(makeHost(unreal), UPROJECT, { autoConnect: false, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(unreal.discover).not.toHaveBeenCalled();
  });

  it('开着时立刻探一次，之后按间隔继续探', async () => {
    vi.useFakeTimers();
    const unreal = makeUnreal();
    renderHook(() =>
      useUnrealConnection(makeHost(unreal), UPROJECT, { autoConnect: true, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(unreal.discover).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(unreal.discover).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(unreal.discover).toHaveBeenCalledTimes(4);

    // 探测用短超时，别让每次探测都卡 3 秒
    const firstCall = (unreal.discover as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[1]).toBeLessThan(3000);
  });

  it('没配工程文件时不探测', async () => {
    vi.useFakeTimers();
    const unreal = makeUnreal();
    renderHook(() =>
      useUnrealConnection(makeHost(unreal), '  ', { autoConnect: true, intervalSec: 5 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(unreal.discover).not.toHaveBeenCalled();
  });

  it('探测到编辑器上线后拉一次清单，状态变 online', async () => {
    const unreal = makeUnreal();
    const { result } = renderHook(() =>
      useUnrealConnection(makeHost(unreal), UPROJECT, { autoConnect: true, intervalSec: 5 }),
    );

    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.node?.projectName).toBe('BulletShootGame');
    expect(unreal.queryCatalog).toHaveBeenCalledOnce();
  });

  it('手动检测会显示「检测中」并顺带拉清单', async () => {
    const unreal = makeUnreal();
    const { result } = renderHook(() =>
      useUnrealConnection(makeHost(unreal), UPROJECT, { autoConnect: false }),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('online');
    expect(unreal.queryCatalog).toHaveBeenCalledOnce();
  });

  it('探测不到就标成 offline，并记下原因', async () => {
    const unreal = makeUnreal({
      discover: vi.fn(async () => ({ nodes: [], error: '没有发现在线的 Unreal 编辑器' })),
    });
    const { result } = renderHook(() =>
      useUnrealConnection(makeHost(unreal), UPROJECT, { autoConnect: false }),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('offline');
    expect(result.current.message).toContain('没有发现');
  });
});
