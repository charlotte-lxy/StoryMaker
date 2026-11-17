// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UpdateApi, UpdateNotice } from '../core/host';
import { UpdateCard, UpdatePrompt } from './UpdatePanel';
import { useUpdater } from './use-updater';

afterEach(cleanup);

function makeApi(overrides: Partial<UpdateApi> = {}) {
  let listener: ((notice: UpdateNotice) => void) | null = null;
  const api: UpdateApi = {
    check: vi.fn(async () => ({
      status: 'available' as const,
      current: '0.1.63',
      latest: '0.1.64',
      size: 1_500_000,
    })),
    download: vi.fn(async () => ({ ok: true })),
    apply: vi.fn(async () => ({ ok: true })),
    onAvailable: (callback) => {
      listener = callback;
      return () => {
        listener = null;
      };
    },
    ...overrides,
  };
  return {
    api,
    emit: (notice: UpdateNotice) => listener?.(notice),
  };
}

function Harness({ api }: { api: UpdateApi }) {
  const updater = useUpdater(api);
  return (
    <>
      <UpdateCard updater={updater} />
      <UpdatePrompt updater={updater} />
    </>
  );
}

describe('版本与更新', () => {
  it('显示当前版本，手动检查后能下载并重启安装', async () => {
    const { api } = makeApi();
    render(<Harness api={api} />);

    expect(screen.getByText(/当前版本 v/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText(/发现新版本 v0\.1\.64/)).toBeTruthy();
    expect(api.check).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '下载更新' }));
    expect(await screen.findByText(/更新已下载，重启后生效/)).toBeTruthy();
    expect(api.download).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '重启并安装' }));
    expect(api.apply).toHaveBeenCalledOnce();
  });

  it('启动时后台检查到新版会弹提示，并能直接下载', async () => {
    const { api, emit } = makeApi();
    render(<Harness api={api} />);

    act(() => {
      emit({ current: '0.1.63', latest: '0.1.64', size: 1_500_000 });
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/当前版本 v0\.1\.63/)).toBeTruthy();
    expect(within(dialog).getByText(/约 1\.4 MB/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '下载更新' }));
    expect(api.download).toHaveBeenCalledOnce();
  });

  it('点稍后关掉提示，不触发下载', async () => {
    const { api, emit } = makeApi();
    render(<Harness api={api} />);

    act(() => {
      emit({ current: '0.1.63', latest: '0.1.64', size: 1_500_000 });
    });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.download).not.toHaveBeenCalled();
  });

  it('没有更新能力的环境显示不支持，检查按钮禁用', () => {
    function NoUpdateHarness() {
      const updater = useUpdater(undefined);
      return <UpdateCard updater={updater} />;
    }
    render(<NoUpdateHarness />);
    expect(screen.getByText(/当前环境不支持自动更新/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '检查更新' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
