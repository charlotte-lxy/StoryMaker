// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostApi, UnrealApi } from '../core/host';
import { ImageAssetCell, SoundAssetCell } from './AssetManager';
import type { AssetLibrary } from './use-asset-library';

afterEach(cleanup);

beforeEach(() => {
  // jsdom 不实现 Blob URL，预览和播放都要用到它
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), writable: true });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  }
});

function makeLibrary(overrides: Partial<AssetLibrary> = {}): AssetLibrary {
  return {
    available: true,
    folder: 'C:/素材',
    loading: false,
    error: '',
    byId: new Map(),
    refresh: () => undefined,
    upload: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    rename: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [] })),
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
    ...overrides,
  };
}

function makeHost(unreal?: UnrealApi): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

function fileOf(fileName: string, kind: 'image' | 'sound' = 'image') {
  const baseName = fileName.slice(0, fileName.lastIndexOf('.'));
  return {
    filePath: `C:\\素材\\${fileName}`,
    fileName,
    baseName,
    kind,
    size: 1024,
    mtimeMs: 1_700_000_000_000,
  };
}

describe('素材管理单元格', () => {
  it('没有桌面能力时说明原因，不给按钮', () => {
    render(<ImageAssetCell id="SCE_Black" library={makeLibrary({ available: false })} host={undefined} />);
    expect(screen.getByText(/桌面版才能管素材/)).toBeTruthy();
  });

  it('没配素材文件夹时让去设置里选', () => {
    render(<ImageAssetCell id="SCE_Black" library={makeLibrary({ folder: '' })} host={makeHost()} />);
    expect(screen.getByText(/先在「设置」里选素材文件夹/)).toBeTruthy();
  });

  it('没有文件时给「上传素材」，点了按非替换方式上传', () => {
    const library = makeLibrary();
    render(<ImageAssetCell id="SCE_Black" library={library} host={makeHost()} />);

    fireEvent.click(screen.getByRole('button', { name: '上传素材' }));
    expect(library.upload).toHaveBeenCalledWith('SCE_Black', 'image', false);
  });

  it('有图片文件时显示文件名和预览 / 重选 / 删除', () => {
    const library = makeLibrary({ byId: new Map([['SCE_Black', [fileOf('SCE_Black.png')]]]) });
    render(<ImageAssetCell id="SCE_Black" library={library} host={makeHost()} />);

    expect(screen.getByText('SCE_Black.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: '预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
  });

  it('点「…」是按替换方式上传，会顺带删掉同 ID 的旧文件', () => {
    const library = makeLibrary({ byId: new Map([['SCE_Black', [fileOf('SCE_Black.png')]]]) });
    render(<ImageAssetCell id="SCE_Black" library={library} host={makeHost()} />);

    fireEvent.click(screen.getByRole('button', { name: '…' }));
    expect(library.upload).toHaveBeenCalledWith('SCE_Black', 'image', true);
  });

  it('同一个 ID 有多个文件时提示重复', () => {
    const library = makeLibrary({
      byId: new Map([['SCE_Black', [fileOf('SCE_Black.jpg'), fileOf('SCE_Black.png')]]]),
    });
    render(<ImageAssetCell id="SCE_Black" library={library} host={makeHost()} />);
    expect(screen.getByText(/有 2 个重复文件/)).toBeTruthy();
  });

  it('删除要二次确认，确认后才真的删', () => {
    const library = makeLibrary({ byId: new Map([['SCE_Black', [fileOf('SCE_Black.png')]]]) });
    render(<ImageAssetCell id="SCE_Black" library={library} host={makeHost()} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('SCE_Black.png');
    expect(library.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(library.remove).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'SCE_Black.png' }),
    );
  });

  it('音效有文件时给播放器：播放按钮、进度条、当前 / 总时长', () => {
    const library = makeLibrary({ byId: new Map([['S_dididi', [fileOf('S_dididi.wav', 'sound')]]]) });
    render(<SoundAssetCell id="S_dididi" library={library} host={makeHost(makeUnreal())} />);

    expect(screen.getByRole('button', { name: '▶' })).toBeTruthy();
    expect(screen.getByTitle('拖动跳转')).toBeTruthy();
    expect(screen.getByText('00:00 / 00:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: '…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
  });

  it('音效没文件时只有「上传素材」', () => {
    const library = makeLibrary();
    render(<SoundAssetCell id="S_dididi" library={library} host={makeHost()} />);
    expect(screen.getByRole('button', { name: '上传素材' })).toBeTruthy();
  });
});
