// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { HostApi, UnrealApi } from '../core/host';
import { useAssetLibrary } from './use-asset-library';

vi.mock('./image-convert', () => ({
  convertImageToPng: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
}));

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [] })),
    queryCatalog: vi.fn(async () => ({ ok: true, dataTables: [], folders: [] })),
    runImport: vi.fn(async () => ({
      ok: false,
      stopped: true,
      items: [],
      importedOwnerUids: [],
      counts: { tables: 0, images: 0, sounds: 0 },
    })),
    pickUproject: vi.fn(async () => null),
    pickAssetFolder: vi.fn(async () => null),
    onImportProgress: vi.fn(() => () => undefined),
    listAssets: vi.fn(async () => ({ ok: true, files: [] })),
    uploadAsset: vi.fn(async () => ({ ok: true })),
    removeAsset: vi.fn(async () => ({ ok: true })),
    renameAsset: vi.fn(async () => ({ ok: true })),
    readAsset: vi.fn(async () => ({ ok: true, data: new Uint8Array([1, 2, 3]) })),
    writeAsset: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function makeHost(unreal: UnrealApi): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

describe('useAssetLibrary.upload', () => {
  it('选到 webp：读源文件、转成 PNG、写进素材文件夹', async () => {
    const unreal = makeUnreal({
      uploadAsset: vi.fn(async () => ({
        ok: false,
        requiresConversion: true,
        sourcePath: 'C:\\素材\\a.webp',
      })),
    });

    const { result } = renderHook(() => useAssetLibrary(makeHost(unreal), 'C:\\素材'));

    await act(async () => {
      const outcome = await result.current.upload('PIC_X', 'image', true);
      expect(outcome.ok).toBe(true);
    });

    expect(unreal.readAsset).toHaveBeenCalledWith('C:\\素材\\a.webp');
    expect(unreal.writeAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'C:\\素材',
        id: 'PIC_X',
        kind: 'image',
        extension: 'png',
        replace: true,
      }),
    );
  });

  it('webp 转不出来时给明确提示，不写文件', async () => {
    const convert = await import('./image-convert');
    vi.mocked(convert.convertImageToPng).mockResolvedValueOnce(null);

    const unreal = makeUnreal({
      uploadAsset: vi.fn(async () => ({
        ok: false,
        requiresConversion: true,
        sourcePath: 'C:\\素材\\a.webp',
      })),
    });

    const { result } = renderHook(() => useAssetLibrary(makeHost(unreal), 'C:\\素材'));

    await act(async () => {
      const outcome = await result.current.upload('PIC_X', 'image', false);
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain('转不成 PNG');
    });

    expect(unreal.writeAsset).not.toHaveBeenCalled();
  });

  it('普通图片走主进程复制，不读不转', async () => {
    const unreal = makeUnreal();

    const { result } = renderHook(() => useAssetLibrary(makeHost(unreal), 'C:\\素材'));

    let ok = false;
    await act(async () => {
      const outcome = await result.current.upload('PIC_X', 'image', false);
      ok = outcome.ok;
    });

    expect(ok).toBe(true);
    expect(unreal.writeAsset).not.toHaveBeenCalled();
  });
});
