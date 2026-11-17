// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostApi, UnrealApi, UnrealNodeInfo } from '../core/host';
import { createEmptyProject } from '../state/operations';
import { DEFAULT_UNREAL_PREFS } from '../state/prefs';
import type { Project } from '../core/types';
import { UnrealImportPage } from './UnrealImportPage';

afterEach(cleanup);

const NODE: UnrealNodeInfo = {
  id: 'UE1',
  user: 'Aogiri',
  machine: 'PC',
  engineVersion: '5.6.1-44394996',
  engineRoot: 'D:/Unreal Engine/UE_5.6/Engine/',
  projectRoot: 'E:/Unreal/UnrealProject/BulletShoot/BulletShootGame/',
  projectName: 'BulletShootGame',
};

/** 只带 unreal 能力的假宿主：页面只用到这一块 */
function makeHost(unreal: UnrealApi | undefined): HostApi {
  return { kind: 'desktop', unreal } as unknown as HostApi;
}

function makeProject(): Project {
  const project = createEmptyProject();
  project.exportSettings = [
    { uid: 'x1', tableName: 'TB_Sound', folder: 'GameContent/BP/Sound', subTable: '音频' },
  ];
  project.soundCategories = [
    { uid: 'cat', name: '音效', path: '/Game/GameContent/Asset/Sound/BackgroundSound' },
  ];
  project.sounds = [{ uid: 'snd', id: 'S_dididi', name: '滴滴滴', categoryUid: 'cat' }];
  return project;
}

const PREFS = { ...DEFAULT_UNREAL_PREFS, uprojectPath: 'E:/UE/BulletShootGame.uproject' };

function makeUnreal(overrides: Partial<UnrealApi> = {}): UnrealApi {
  return {
    discover: vi.fn(async () => ({ nodes: [NODE] })),
    runImport: vi.fn(async () => ({
      ok: true,
      success: true,
      counts: { tables: 1, images: 0, sounds: 1 },
      missing: { images: [], sounds: [] },
      unused: { images: [], sounds: [] },
      skipped: { images: 0, sounds: 0 },
      output: [
        'SMK_IMPORT_RESULT [{"kind":"table","label":"TB_Sound","ok":true,"detail":"已导入"},{"kind":"sound","label":"S_dididi","ok":true,"detail":"已导入"}]',
      ],
    })),
    pickUproject: vi.fn(async () => null),
    pickAssetFolder: vi.fn(async () => null),
    ...overrides,
  };
}

describe('导入到 Unreal 页', () => {
  it('没有桌面能力的宿主上说明清楚，并禁用检查按钮', () => {
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(undefined)}
      />,
    );
    expect(screen.getByText(/只有桌面版（StoryMaker.exe）支持/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '检测连接' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('检测连接后显示工程名和引擎版本', async () => {
    const unreal = makeUnreal();
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(unreal)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '检测连接' }));
    expect(await screen.findByText(/已连接 BulletShootGame（引擎 5\.6\.1/)).toBeTruthy();
    expect(unreal.discover).toHaveBeenCalledWith(PREFS.uprojectPath);
  });

  it('导完把每条结果摊出来', async () => {
    const unreal = makeUnreal();
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(unreal)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    expect(await screen.findByText('TB_Sound')).toBeTruthy();
    // 一条表、一条音效，都显示「成功」
    expect(screen.getAllByText('成功')).toHaveLength(2);
    expect(unreal.runImport).toHaveBeenCalledOnce();
  });

  it('失败条目单列出来，并提示缺了哪些素材文件', async () => {
    const unreal = makeUnreal({
      runImport: vi.fn(async () => ({
        ok: true,
        success: true,
        counts: { tables: 0, images: 1, sounds: 0 },
        missing: { images: ['SCE_Black'], sounds: [] },
        unused: { images: [], sounds: [] },
        skipped: { images: 1, sounds: 0 },
        output: [
          'SMK_IMPORT_RESULT [{"kind":"image","label":"SCE_Black","ok":false,"detail":"导入没有产出资产"}]',
        ],
      })),
    });
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(unreal)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    expect(await screen.findByText('导入没有产出资产')).toBeTruthy();
    expect(screen.getByText(/找不到这些文件名/)).toBeTruthy();
  });

  it('没配工程路径时不让点开始导入', () => {
    render(
      <UnrealImportPage
        project={makeProject()}
        prefs={DEFAULT_UNREAL_PREFS}
        onChangePrefs={() => undefined}
        host={makeHost(makeUnreal())}
      />,
    );
    expect((screen.getByRole('button', { name: '开始导入' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
