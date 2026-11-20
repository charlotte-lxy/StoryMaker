// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HostApi,
  UnrealApi,
  UnrealImportProgress,
  UnrealImportReport,
  UnrealImportRequest,
  UnrealNodeInfo,
} from '../../core/host';
import { createEmptyProject } from '../../state/operations';
import { DEFAULT_UNREAL_PREFS } from '../../state/prefs';
import type { Project } from '../../core/types';
import type { AssetLibrary } from '../use-asset-library';
import type { UnrealConnection } from '../use-unreal-connection';
import { ExportToUeDialog } from './ExportToUeDialog';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
});

const NODE: UnrealNodeInfo = {
  id: 'UE1',
  user: 'Aogiri',
  machine: 'PC',
  engineVersion: '5.6.1',
  engineRoot: 'D:/Unreal Engine/UE_5.6/Engine/',
  projectRoot: 'E:/BulletShootGame/',
  projectName: 'BulletShootGame',
};

function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_Sound', folder: 'GameContent/BP/Sound', subTable: '音频' },
  ];
  project.imageCategories = [
    { uid: 'cat', name: '对话背景', path: '/Game/GameContent/Asset/Image/StoryBackground' },
  ];
  project.images = [{ uid: 'img', id: 'SCE_Black', name: '黑', categoryUid: 'cat' }];
  project.soundCategories = [
    { uid: 'sc', name: '音效', path: '/Game/GameContent/Asset/Sound/BackgroundSound' },
  ];
  project.sounds = [{ uid: 'snd', id: 'S_dididi', name: '滴滴', categoryUid: 'sc' }];
  return project;
}

const PREFS = {
  ...DEFAULT_UNREAL_PREFS,
  uprojectPath: 'E:/UE/BulletShootGame.uproject',
  assetFolder: 'C:\\素材',
};

export function assetFile(fileName: string, kind: 'image' | 'sound') {
  return {
    filePath: `C:\\素材\\${fileName}`,
    fileName,
    baseName: fileName.slice(0, fileName.lastIndexOf('.')),
    kind,
    size: 1024,
    mtimeMs: 1_700_000_000_000,
  };
}

export function makeLibrary(files: ReturnType<typeof assetFile>[] = []): AssetLibrary {
  const byId = new Map<string, ReturnType<typeof assetFile>[]>();
  for (const file of files) {
    const list = byId.get(file.baseName) ?? [];
    list.push(file);
    byId.set(file.baseName, list);
  }
  return {
    available: true,
    folder: 'C:\\素材',
    loading: false,
    error: '',
    byId,
    refresh: () => undefined,
    upload: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    rename: vi.fn(async () => ({ ok: true })),
  };
}

export function makeConnection(overrides: Partial<UnrealConnection> = {}): UnrealConnection {
  return {
    available: true,
    status: 'online',
    node: NODE,
    message: '',
    catalog: { dataTables: [], folders: ['/Game'] },
    catalogLoading: false,
    catalogError: '',
    connect: vi.fn(async () => undefined),
    refreshCatalog: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [NODE] })),
    queryCatalog: vi.fn(async () => ({ ok: true, dataTables: [], folders: [] })),
    runImport: vi.fn(async (request: UnrealImportRequest): Promise<UnrealImportReport> => ({
      ok: true,
      stopped: false,
      items: [
        ...request.plan.images.map((item) => ({
          kind: 'image' as const,
          label: item.id,
          ok: true,
          detail: '已导入',
        })),
        ...request.plan.sounds.map((item) => ({
          kind: 'sound' as const,
          label: item.id,
          ok: true,
          detail: '已导入',
        })),
        ...request.plan.tables.map((item) => ({
          kind: 'table' as const,
          label: item.label,
          ok: true,
          detail: '已导入',
        })),
      ],
      importedOwnerUids: [
        ...request.plan.images.map((item) => item.ownerUid),
        ...request.plan.sounds.map((item) => item.ownerUid),
      ],
      counts: {
        tables: request.plan.tables.length,
        images: request.plan.images.length,
        sounds: request.plan.sounds.length,
      },
    })),
    onImportProgress: vi.fn(() => () => undefined),
    pickUproject: vi.fn(async () => null),
    pickAssetFolder: vi.fn(async () => null),
    listAssets: vi.fn(async () => ({ ok: true, files: [] })),
    uploadAsset: vi.fn(async () => ({ ok: false, canceled: true })),
    removeAsset: vi.fn(async () => ({ ok: true })),
    renameAsset: vi.fn(async () => ({ ok: true })),
    readAsset: vi.fn(async () => ({ ok: true, data: new Uint8Array() })),
    ...overrides,
  };
}

function makeHost(unreal: UnrealApi | undefined): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

function renderDialog(options: {
  unreal?: UnrealApi;
  connection?: UnrealConnection;
  library?: AssetLibrary;
  onClose?: () => void;
}) {
  const onClose = options.onClose ?? vi.fn();
  render(
    <ExportToUeDialog
      project={makeProject()}
      prefs={PREFS}
      host={makeHost(options.unreal ?? makeUnreal())}
      library={options.library ?? makeLibrary()}
      connection={options.connection ?? makeConnection()}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('导出到 UE 弹窗', () => {
  it('没连上编辑器时提示先去导入设置连，按钮不能点', () => {
    renderDialog({ connection: makeConnection({ status: 'offline', node: null }) });
    expect(screen.getByText(/先去「导出 → Unreal导入设置」里点「检测连接」/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '导入' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '全量导入' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('把素材的新增 / 未变统计摊出来', () => {
    renderDialog({
      library: makeLibrary([assetFile('SCE_Black.png', 'image'), assetFile('S_dididi.wav', 'sound')]),
    });
    expect(screen.getAllByText('新增 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未变 0').length).toBeGreaterThan(0);
  });

  it('点导入只提交变化项，数据表全量', async () => {
    const unreal = makeUnreal();
    renderDialog({
      unreal,
      library: makeLibrary([assetFile('SCE_Black.png', 'image'), assetFile('S_dididi.wav', 'sound')]),
    });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledOnce());

    const request = (unreal.runImport as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.plan.images[0]).toMatchObject({ ownerUid: 'img', id: 'SCE_Black' });
    expect(request.plan.sounds[0]).toMatchObject({ ownerUid: 'snd', id: 'S_dididi' });
    expect(request.plan.tables.map((table: { label: string }) => table.label)).toEqual(['TB_Sound']);
  });

  it('导完把结果列出来，按钮变成「完成」', async () => {
    renderDialog({
      library: makeLibrary([assetFile('SCE_Black.png', 'image')]),
    });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(await screen.findByText('SCE_Black')).toBeTruthy();
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
  });

  it('素材失败时给出提示，不继续导数据表', async () => {
    const unreal = makeUnreal({
      runImport: vi.fn(async () => ({
        ok: true,
        stopped: true,
        message: '有 1 个素材没导成功，数据表先不导',
        items: [
          { kind: 'image' as const, label: 'SCE_Black', ok: false, detail: '导入没有产出资产' },
        ],
        importedOwnerUids: [],
        counts: { tables: 1, images: 1, sounds: 0 },
      })),
    });
    renderDialog({ unreal, library: makeLibrary([assetFile('SCE_Black.png', 'image')]) });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(await screen.findByText(/导入没有产出资产/)).toBeTruthy();
    expect(screen.getByText(/有 1 个素材没导成功/)).toBeTruthy();
  });

  it('导入中把进度事件画成进度条', async () => {
    let push: ((progress: UnrealImportProgress) => void) | null = null;
    const unreal = makeUnreal({
      onImportProgress: (listener) => {
        push = listener;
        return () => undefined;
      },
      runImport: vi.fn(
        (): Promise<UnrealImportReport> =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  stopped: false,
                  items: [],
                  importedOwnerUids: [],
                  counts: { tables: 1, images: 1, sounds: 0 },
                }),
              30,
            );
          }),
      ),
    });
    renderDialog({ unreal, library: makeLibrary([assetFile('SCE_Black.png', 'image')]) });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(push).not.toBeNull());

    push!({ phase: 'assets', current: 1, total: 2, label: 'SCE_Black', status: 'running' });
    expect(await screen.findByText(/导入素材/)).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('.import-progress-head')?.textContent).toContain('1 / 2');
    });
  });

  it('点完成关闭弹窗', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose, library: makeLibrary([assetFile('SCE_Black.png', 'image')]) });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await screen.findByRole('button', { name: '完成' });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
