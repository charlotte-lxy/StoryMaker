// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 桌面版的启动流程。
 *
 * 这里刻意不 import App：desktop.ts 是在模块求值时读取 window.storymakerDesktop 的，
 * 必须先把假的桌面接口挂上去，再动态 import App（配合 resetModules）。
 */

const PROJECT_PATH = 'D:\\策划\\序章.json';

const onDisk = JSON.stringify({ version: 1, name: '磁盘上的项目', chapters: [] });
const inCache = JSON.stringify({ version: 1, name: '缓存里的旧项目', chapters: [] });

function installDesktopMock(
  readProject: (filePath: string) => Promise<{
    canceled: boolean;
    filePath?: string;
    content?: string;
  }> = vi.fn(async () => ({ canceled: false, filePath: PROJECT_PATH, content: onDisk })),
) {
  const saveProject = vi.fn(
    async (_payload: { content: string; suggestedName: string; currentPath: string | null }) => ({
      canceled: false,
      filePath: PROJECT_PATH,
    }),
  );

  window.storymakerDesktop = {
    isDesktop: true,
    saveProject,
    openProject: vi.fn(async () => ({ canceled: true })),
    readProject,
    saveFileAs: vi.fn(async () => ({ canceled: true })),
    revealFile: vi.fn(async () => true),
  };

  return { saveProject, readProject };
}

const sessionPath = (): string | null =>
  (JSON.parse(window.localStorage.getItem('storymaker.session.v1') ?? '{}') as {
    projectPath?: string | null;
  }).projectPath ?? null;

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  delete window.storymakerDesktop;
  delete document.documentElement.dataset.theme;
});

describe('桌面版的自动加载', () => {
  it('启动时按记忆的路径把上次的项目文件读回来', async () => {
    window.localStorage.setItem('storymaker.session.v1', JSON.stringify({ projectPath: PROJECT_PATH }));
    window.localStorage.setItem('storymaker.project.v1', inCache);

    // 故意让读盘慢过自动保存的 800ms 防抖：没有「读回期间不写盘」的保护，
    // 缓存就会在这个空档里把磁盘文件覆盖掉
    const readProject = vi.fn(async () => {
      await new Promise((done) => setTimeout(done, 900));
      return { canceled: false, filePath: PROJECT_PATH, content: onDisk };
    });
    const { saveProject } = installDesktopMock(readProject);

    const { default: App } = await import('./App');
    render(<App />);

    expect(readProject).toHaveBeenCalledWith(PROJECT_PATH);
    await waitFor(() => expect(screen.getByDisplayValue('磁盘上的项目')).toBeTruthy(), {
      timeout: 3000,
    });

    const written = saveProject.mock.calls.map(([payload]) => payload.content);
    expect(written.some((content) => content.includes('缓存里的旧项目'))).toBe(false);
    expect(sessionPath()).toBe(PROJECT_PATH);
  });

  it('上次的文件打不开时退回缓存，清掉路径，并且不再往那儿写盘', async () => {
    window.localStorage.setItem(
      'storymaker.session.v1',
      JSON.stringify({ projectPath: 'D:\\策划\\没了.json' }),
    );
    window.localStorage.setItem('storymaker.project.v1', inCache);

    const { saveProject, readProject } = installDesktopMock(vi.fn(async () => ({ canceled: true })));
    const { default: App } = await import('./App');
    render(<App />);

    await waitFor(() => expect(sessionPath()).toBeNull());
    expect(screen.getByDisplayValue('缓存里的旧项目')).toBeTruthy();

    // 自动写盘的防抖是 800ms，等过去之后依然不能有写入
    await new Promise((done) => setTimeout(done, 900));
    expect(readProject).toHaveBeenCalledWith('D:\\策划\\没了.json');
    expect(saveProject).not.toHaveBeenCalled();
  });
});
