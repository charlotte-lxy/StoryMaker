// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostApi, UnrealApi } from '../core/host';
import type { LookupRow } from '../core/types';
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

function makeHost(unreal?: UnrealApi): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

/** 一条音效行：默认音量 / 音调都不填（= 1.0） */
function soundRow(id: string, volume?: number, pitch?: number): LookupRow {
  return {
    uid: `uid-${id}`,
    id,
    name: '',
    ...(volume === undefined ? {} : { volume }),
    ...(pitch === undefined ? {} : { pitch }),
  };
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

  it('音效有文件时给播放器：播放 / 编辑 / 重选 / 删除都在一行', () => {
    const library = makeLibrary({ byId: new Map([['S_dididi', [fileOf('S_dididi.wav', 'sound')]]]) });
    render(
      <SoundAssetCell
        row={soundRow('S_dididi')}
        library={library}
        host={makeHost(makeUnreal())}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '▶' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
    // 不再有进度条 / 时长：播放按钮直接按这一行的音量 / 音调播
    expect(screen.queryByTitle('拖动跳转')).toBeNull();
  });

  it('点播放会按这一行的音量 / 音调播（jsdom 没有 AudioContext，给出失败提示而不是卡住）', async () => {
    const library = makeLibrary({ byId: new Map([['S_dididi', [fileOf('S_dididi.wav', 'sound')]]]) });
    render(
      <SoundAssetCell
        row={soundRow('S_dididi', 1.5, 0.8)}
        library={library}
        host={makeHost(makeUnreal())}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '▶' }));
    expect(await screen.findByText(/播放失败/)).toBeTruthy();
  });

  it('音效没文件时只有「上传素材」', () => {
    const library = makeLibrary();
    render(
      <SoundAssetCell
        row={soundRow('S_dididi')}
        library={library}
        host={makeHost()}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '上传素材' })).toBeTruthy();
    // 没素材也能先设音量 / 音调
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
  });

  it('音频编辑：调音量 / 音调写回音效行，恢复默认回到 1.0', () => {
    const library = makeLibrary({ byId: new Map([['S_dididi', [fileOf('S_dididi.wav', 'sound')]]]) });
    const onUpdate = vi.fn();
    render(
      <SoundAssetCell
        row={soundRow('S_dididi')}
        library={library}
        host={makeHost(makeUnreal())}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('音频编辑：S_dididi')).toBeTruthy();

    const sliders = within(dialog).getAllByRole('slider') as HTMLInputElement[];
    expect(sliders).toHaveLength(2);
    expect(sliders[0].value).toBe('1');
    expect(sliders[1].value).toBe('1');

    fireEvent.change(sliders[0], { target: { value: '1.5' } });
    expect(onUpdate).toHaveBeenCalledWith({ volume: 1.5 });
    fireEvent.change(sliders[1], { target: { value: '0.8' } });
    expect(onUpdate).toHaveBeenCalledWith({ pitch: 0.8 });

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复默认' }));
    expect(onUpdate).toHaveBeenCalledWith({ volume: 1, pitch: 1 });
  });
});
