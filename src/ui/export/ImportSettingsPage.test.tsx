// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnrealCatalogTable } from '../../core/host';
import { createEmptyProject } from '../../state/operations';
import type { Project } from '../../core/types';
import type { UnrealConnection } from '../use-unreal-connection';
import { ImportSettingsPage } from './ImportSettingsPage';

afterEach(cleanup);

const TABLES: UnrealCatalogTable[] = [
  { name: 'TB_Dialogue', path: '/Game/GameContent/BP/StorySystem/TB_Dialogue', folder: '/Game/GameContent/BP/StorySystem' },
  { name: 'TB_Image', path: '/Game/GameContent/BP/Image/TB_Image', folder: '/Game/GameContent/BP/Image' },
];

function makeConnection(overrides: Partial<UnrealConnection> = {}): UnrealConnection {
  return {
    available: true,
    status: 'online',
    node: {
      id: 'UE1',
      user: 'A',
      machine: 'PC',
      engineVersion: '5.6.1',
      engineRoot: '',
      projectRoot: '',
      projectName: 'BulletShootGame',
    },
    message: '',
    catalog: { dataTables: TABLES, folders: ['/Game/GameContent', '/Game/GameContent/BP'] },
    catalogLoading: false,
    catalogError: '',
    connect: vi.fn(async () => undefined),
    refreshCatalog: vi.fn(async () => undefined),
    ...overrides,
  };
}

const OFFLINE = makeConnection({ status: 'offline', node: null, catalog: null, message: '没连上' });


/** 受控组件：要真的能改 project */
function Harness({ connection }: { connection: UnrealConnection }) {
  const [project, setProject] = useState<Project>(() => {
    const base = createEmptyProject();
    base.exportSettings = [
      { uid: 'x1', tableName: '', folder: '', subTable: '对话' },
    ];
    base.battle.weaponClassPrefix = "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/Weapon/WeaponActors/";
    return base;
  });

  return (
    <ImportSettingsPage
      project={project}
      onChange={setProject}
      connection={connection}
    />
  );
}

describe('Unreal 导入设置页', () => {
  it('没连上时数据表下拉和前缀选择都不能用', () => {
    render(<Harness connection={OFFLINE} />);

    const tablePicker = screen.getByTitle('连接编辑器后才能选') as HTMLSelectElement;
    expect(tablePicker.disabled).toBe(true);

    const pickers = screen.getAllByRole('button', { name: '选择文件夹…' }) as HTMLButtonElement[];
    expect(pickers).toHaveLength(5);
    for (const button of pickers) expect(button.disabled).toBe(true);
  });

  it('连上之后数据表下拉列出编辑器里的表，选中会自动填好文件夹', () => {
    render(<Harness connection={makeConnection()} />);

    const tablePicker = screen.getByTitle('选编辑器里的哪张 DataTable') as HTMLSelectElement;
    expect(tablePicker.disabled).toBe(false);
    expect([...tablePicker.options].map((option) => option.value)).toEqual([
      '',
      '/Game/GameContent/BP/StorySystem/TB_Dialogue',
      '/Game/GameContent/BP/Image/TB_Image',
    ]);

    fireEvent.change(tablePicker, {
      target: { value: '/Game/GameContent/BP/StorySystem/TB_Dialogue' },
    });

    // 表名和文件夹都被填好了：下拉的值是拼出来的资产路径
    expect((screen.getByTitle('选编辑器里的哪张 DataTable') as HTMLSelectElement).value).toBe(
      '/Game/GameContent/BP/StorySystem/TB_Dialogue',
    );
  });

  it('连上之后点「选择文件夹…」能走目录树，选完前缀跟着变', () => {
    render(<Harness connection={makeConnection()} />);

    const pickers = screen.getAllByRole('button', { name: '选择文件夹…' }) as HTMLButtonElement[];
    fireEvent.click(pickers[0]);

    // 树默认展开 Content，GameContent 在第一层；点 ▸ 展开它
    expect(screen.getByRole('button', { name: 'GameContent' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '▸' })[0]);
    expect(screen.getByRole('button', { name: 'BP' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'BP' }));
    fireEvent.click(screen.getByRole('button', { name: '用这个文件夹' }));

    const prefix = screen.getByDisplayValue(
      "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/",
    ) as HTMLInputElement;
    expect(prefix.readOnly).toBe(true);
  });

  it('项目里配过、但编辑器里没有的表，原样列出来并标「编辑器里找不到」', () => {
    function StaleHarness() {
      const [project] = useState<Project>(() => {
        const base = createEmptyProject();
        base.exportSettings = [
          { uid: 'x1', tableName: 'TB_Gone', folder: 'GameContent/BP/Gone', subTable: '对话' },
        ];
        return base;
      });
      return (
        <ImportSettingsPage
          project={project}
          onChange={() => undefined}
          connection={makeConnection()}
        />
      );
    }

    render(<StaleHarness />);
    expect(screen.getByText('/Game/GameContent/BP/Gone/TB_Gone（编辑器里找不到）')).toBeTruthy();
  });
});
