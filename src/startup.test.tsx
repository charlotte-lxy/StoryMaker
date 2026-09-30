// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { clearFakeHost, installFakeHost, seedProjectFile } from './testing/app-harness';

/**
 * 启动流程：项目内容只存在磁盘上的 .json 里，界面必须在确定这个文件之后才放出来。
 *
 * 这里刻意不做任何本机缓存，所以"读不回来"只能退回门槛页让用户重新选文件。
 */

const PROJECT_PATH = 'D:\\策划\\序章.json';
const nameInput = () => screen.getByTitle('项目名称，也是导出文件名');
const gateButton = (label: string) => screen.findByRole('button', { name: label });

/** 标题栏左上的「文件」菜单：新建、打开、保存、另存为都收在里面 */
const fileItem = (label: string) => screen.getByRole('button', { name: label });
function openFileMenu(): void {
  fireEvent.click(screen.getByTitle('项目文件：新建 / 打开 / 保存 / 另存为'));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  clearFakeHost();
});

describe('启动时按上次的路径读回项目', () => {
  it('记得路径：直接把项目文件读回界面', async () => {
    seedProjectFile(
      JSON.stringify({ version: 1, name: '磁盘上的项目', chapters: [] }),
      PROJECT_PATH,
    );
    render(<App />);

    expect(await screen.findByDisplayValue('磁盘上的项目')).toBeTruthy();
    expect(screen.queryByText('先确定一个项目文件')).toBeNull();
  });

  it('文件打不开：停在门槛页，忘掉这个路径，并且不往那儿写任何东西', async () => {
    const host = installFakeHost({}, 'D:\\策划\\没了.json');
    render(<App />);

    await gateButton('新建项目文件');
    expect(screen.getByText(/「没了.json」没能打开/)).toBeTruthy();
    // 路径要清掉，否则每次启动都会白试一次
    expect(window.localStorage.getItem('storymaker.session.v1')).toContain('null');

    await new Promise((done) => setTimeout(done, 900));
    expect(host.written).toHaveLength(0);
  });

  it('从来没记过路径：直接停在门槛页', async () => {
    installFakeHost({}, null);
    render(<App />);

    await gateButton('新建项目文件');
    expect(screen.getByText('先确定一个项目文件')).toBeTruthy();
    expect(screen.queryByTitle('项目名称，也是导出文件名')).toBeNull();
  });
});

describe('门槛页', () => {
  it('没有本地服务时，给出改用「启动StoryMaker.bat」的提示', async () => {
    clearFakeHost();
    render(<App />);

    await gateButton('新建项目文件');
    expect(screen.getByText(/启动StoryMaker\.bat/)).toBeTruthy();
    // 编辑界面一点都不能露出来
    expect(screen.queryByTitle('项目名称，也是导出文件名')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('新建项目文件：选好路径后写一份空项目，并记住这个新路径', async () => {
    const host = installFakeHost({}, null);
    host.nextNewPath = PROJECT_PATH;
    render(<App />);

    fireEvent.click(await gateButton('新建项目文件'));

    await screen.findByTitle('项目名称，也是导出文件名');
    const written = host.disk.get(PROJECT_PATH) ?? '';
    expect(written).toContain('"chapters"');
    expect(JSON.parse(written)).toMatchObject({ version: 1 });
    expect(window.localStorage.getItem('storymaker.session.v1')).toContain('序章.json');
    expect(host.picks).toEqual(['new']);
  });

  it('新建时取消对话框：留在门槛页，什么都不写', async () => {
    const host = installFakeHost({}, null);
    host.nextNewPath = null;
    render(<App />);

    fireEvent.click(await gateButton('新建项目文件'));

    await new Promise((done) => setTimeout(done, 50));
    expect(host.picks).toEqual(['new']);
    expect(host.written).toHaveLength(0);
    expect(screen.getByText('先确定一个项目文件')).toBeTruthy();
  });

  it('打开已有项目文件：读进界面后不再显示门槛', async () => {
    const host = installFakeHost({}, null);
    host.nextOpen = {
      filePath: PROJECT_PATH,
      content: JSON.stringify({ version: 1, name: '老项目', chapters: [] }),
    };
    render(<App />);

    fireEvent.click(await gateButton('打开已有项目文件'));

    await screen.findByDisplayValue('老项目');
    expect(screen.queryByText('先确定一个项目文件')).toBeNull();
    expect(window.localStorage.getItem('storymaker.session.v1')).toContain('序章.json');
  });

  it('打开的文件不是项目文件：提示一句，仍留在门槛页', async () => {
    const host = installFakeHost({}, null);
    host.nextOpen = { filePath: 'D:\\策划\\随便.json', content: '{"随便":1}' };
    render(<App />);

    fireEvent.click(await gateButton('打开已有项目文件'));

    expect(await screen.findByText('这个文件不是 StoryMaker 项目文件')).toBeTruthy();
    expect(screen.getByText('先确定一个项目文件')).toBeTruthy();
  });
});

describe('保存与另存为', () => {
  it('「保存」把内容写回当前项目文件', async () => {
    const host = seedProjectFile(
      JSON.stringify({ version: 1, name: '磁盘上的项目', chapters: [] }),
      PROJECT_PATH,
    );
    render(<App />);
    await screen.findByDisplayValue('磁盘上的项目');

    fireEvent.change(nameInput(), { target: { value: '改过的名字' } });
    openFileMenu();
    fireEvent.click(fileItem('保存'));

    expect(await screen.findByText(`已保存到 ${PROJECT_PATH}`)).toBeTruthy();
    expect(host.disk.get(PROJECT_PATH)).toContain('改过的名字');
  });

  it('「另存为」换一个项目文件，之后的自动保存都写进新文件', async () => {
    const host = seedProjectFile(
      JSON.stringify({ version: 1, name: '磁盘上的项目', chapters: [] }),
      PROJECT_PATH,
    );
    render(<App />);
    await screen.findByDisplayValue('磁盘上的项目');

    const nextPath = 'D:\\策划\\第二个.json';
    host.nextNewPath = nextPath;
    openFileMenu();
    fireEvent.click(fileItem('另存为'));

    expect(await screen.findByText(`已另存为 ${nextPath}`)).toBeTruthy();
    expect(host.disk.get(nextPath)).toContain('磁盘上的项目');
    expect(window.localStorage.getItem('storymaker.session.v1')).toContain('第二个.json');

    // 另存为之后，改动应该写进新文件
    host.written.length = 0;
    fireEvent.change(nameInput(), { target: { value: '改到新文件' } });
    await waitFor(() => expect(host.written.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(host.written.every((item) => item.filePath === nextPath)).toBe(true);
    expect(host.disk.get(nextPath)).toContain('改到新文件');
  });
});
