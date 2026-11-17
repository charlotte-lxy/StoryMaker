// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HostApi,
  UnrealApi,
  UnrealNodeInfo,
  UnrealImportProgress,
  UnrealImportRequest,
  UnrealImportReport,
} from '../core/host';
import { createEmptyProject } from '../state/operations';
import { DEFAULT_UNREAL_PREFS } from '../state/prefs';
import type { Project } from '../core/types';
import { UnrealImportPage } from './UnrealImportPage';
import type { AssetLibrary } from './use-asset-library';

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
});

const NODE: UnrealNodeInfo = {
  id: 'UE1',
  user: 'Aogiri',
  machine: 'PC',
  engineVersion: '5.6.1-44394996',
  engineRoot: 'D:/Unreal Engine/UE_5.6/Engine/',
  projectRoot: 'E:/Unreal/UnrealProject/BulletShoot/BulletShootGame/',
  projectName: 'BulletShootGame',
};

function makeHost(unreal: UnrealApi | undefined): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

/** 一张图 + 一条音效，都配好分类 */
function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_Sound', folder: 'GameContent/BP/Sound', subTable: '音频' },
    { uid: 'x2', tableName: 'TB_Image', folder: 'GameContent/BP/Image', subTable: '图片' },
  ];
  project.imageCategories = [
    { uid: 'cat-bg', name: '对话背景', path: '/Game/GameContent/Asset/Image/StoryBackground' },
  ];
  project.images = [{ uid: 'img', id: 'SCE_Black', name: '黑', categoryUid: 'cat-bg' }];
  project.soundCategories = [
    { uid: 'cat-sfx', name: '音效', path: '/Game/GameContent/Asset/Sound/BackgroundSound' },
  ];
  project.sounds = [{ uid: 'snd', id: 'S_dididi', name: '滴滴', categoryUid: 'cat-sfx' }];
  return project;
}

const PREFS = {
  ...DEFAULT_UNREAL_PREFS,
  uprojectPath: 'E:/UE/BulletShootGame.uproject',
  assetFolder: 'C:\\素材',
};

function assetFile(fileName: string, kind: 'image' | 'sound') {
  return {
    filePath: `C:\\素材\\${fileName}`,
    fileName,
    baseName: fileName.slice(0, fileName.lastIndexOf('.')),
    kind,
    size: 1024,
    mtimeMs: 1_700_000_000_000,
  };
}

function makeLibrary(files: ReturnType<typeof assetFile>[] = []): AssetLibrary {
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

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [NODE] })),
    runImport: vi.fn(async (request: UnrealImportRequest) => ({
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

function renderPage(unreal: UnrealApi | undefined, library = makeLibrary()) {
  return render(
    <UnrealImportPage
      project={makeProject()}
      prefs={PREFS}
      onChangePrefs={() => undefined}
      host={makeHost(unreal)}
      library={library}
    />,
  );
}

describe('导入到 Unreal 页', () => {
  it('没有桌面能力的宿主上说明清楚，并禁用检查按钮', () => {
    renderPage(undefined);
    expect(screen.getByText(/只有桌面版（StoryMaker.exe）支持/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '检测连接' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('检测连接后显示工程名和引擎版本', async () => {
    const unreal = makeUnreal();
    renderPage(unreal);

    fireEvent.click(screen.getByRole('button', { name: '检测连接' }));
    expect(await screen.findByText(/已连接 BulletShootGame（引擎 5\.6\.1/)).toBeTruthy();
    expect(unreal.discover).toHaveBeenCalledWith(PREFS.uprojectPath);
  });

  it('素材文件夹里有文件时，导入会把它们都算成新增', async () => {
    const unreal = makeUnreal();
    const library = makeLibrary([
      assetFile('SCE_Black.png', 'image'),
      assetFile('S_dididi.wav', 'sound'),
    ]);
    renderPage(unreal, library);

    expect(screen.getAllByText('新增 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('修改 0').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '导入' }));

    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledOnce());
    const request = (unreal.runImport as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.plan.images).toEqual([
      {
        ownerUid: 'img',
        id: 'SCE_Black',
        assetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
        sourcePath: 'C:\\素材\\SCE_Black.png',
        previousAssetPath: undefined,
      },
    ]);
    expect(request.plan.sounds).toHaveLength(1);
    expect(request.plan.sounds[0].ownerUid).toBe('snd');
    // 数据表永远全量
    expect(request.plan.tables.map((table: { label: string }) => table.label)).toEqual([
      'TB_Sound',
      'TB_Image',
    ]);
  });

  it('导入成功后素材记成已导入，但按钮仍可点——再点就只导数据表', async () => {
    const unreal = makeUnreal();
    renderPage(
      unreal,
      makeLibrary([assetFile('SCE_Black.png', 'image'), assetFile('S_dididi.wav', 'sound')]),
    );

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledOnce());

    // 标记写进 localStorage 后，两个素材都算「未变」
    await waitFor(() => expect(screen.getAllByText(/未变 1/).length).toBeGreaterThan(0));

    // 按钮不能因为「没有素材变更」而变灰：改完数据表还得能导
    const button = screen.getByRole('button', { name: '导入' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledTimes(2));
    const second = (unreal.runImport as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(second.plan.images).toEqual([]);
    expect(second.plan.sounds).toEqual([]);
    expect(second.plan.tables).toHaveLength(2);
  });

  it('条目改了 ID：靠 uid 认出来，导入时带上旧资产路径去改名', async () => {
    const unreal = makeUnreal();
    const base = makeProject();
    const before = makeLibrary([assetFile('SCE_Black.png', 'image')]);

    const view = render(
      <UnrealImportPage
        project={base}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(unreal)}
        library={before}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledOnce());

    // 改 ID，素材文件也跟着改名（这里直接换成改好名的素材列表）
    const renamed = {
      ...base,
      images: base.images.map((row) => ({ ...row, id: 'SCE_New' })),
    };
    view.rerender(
      <UnrealImportPage
        project={renamed}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(unreal)}
        library={makeLibrary([assetFile('SCE_New.png', 'image')])}
      />,
    );

    expect(await screen.findByText('改名 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(unreal.runImport).toHaveBeenCalledTimes(2));
    const second = (unreal.runImport as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(second.plan.images[0]).toMatchObject({
      ownerUid: 'img',
      id: 'SCE_New',
      previousAssetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
    });
  });

  it('素材导入失败时停下，不导数据表', async () => {
    const unreal = makeUnreal({
      runImport: vi.fn(async () => ({
        ok: true,
        stopped: true,
        message: '有 1 个素材没导成功，数据表先不导',
        items: [{ kind: 'image' as const, label: 'SCE_Black', ok: false, detail: '导入没有产出资产' }],
        importedOwnerUids: [],
        counts: { tables: 1, images: 1, sounds: 0 },
      })),
    });
    renderPage(unreal, makeLibrary([assetFile('SCE_Black.png', 'image')]));

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(await screen.findByText(/导入没有产出资产/)).toBeTruthy();
    expect(screen.getByText(/有 1 个素材没导成功/)).toBeTruthy();
  });

  it('没配工程路径时两个按钮都不能点', () => {
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={DEFAULT_UNREAL_PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(makeUnreal())}
        library={makeLibrary()}
      />,
    );
    expect((screen.getByRole('button', { name: '导入' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '全量导入' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('导入过程中把进度事件画成进度条', async () => {
    let push: ((progress: UnrealImportProgress) => void) | null = null;
    const unreal = makeUnreal({
      onImportProgress: (listener) => {
        push = listener;
        return () => undefined;
      },
      runImport: vi.fn(
        (): Promise<UnrealImportReport> =>
          new Promise((resolve) => {
            // 让界面先收到进度事件，再完成
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
    renderPage(unreal, makeLibrary([assetFile('SCE_Black.png', 'image')]));

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    await waitFor(() => expect(push).not.toBeNull());

    push!({ phase: 'assets', current: 1, total: 2, label: 'SCE_Black', status: 'running' });
    expect(await screen.findByText(/导入素材/)).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText(/正在导入：SCE_Black/)).toBeTruthy();
  });
});
