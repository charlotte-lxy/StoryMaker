import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import App from '../App';
import type { DesktopBridge } from '../core/host';
import { createEmptyProject } from '../state/operations';
import { saveSessionPath } from '../state/prefs';

/**
 * 测试用的假宿主。
 *
 * 界面只通过 HostApi 读写项目文件，所以这里装一个假桌面宿主，
 * 配一块"磁盘"（Map）就能在 jsdom 里跑完整的打开 / 编辑 / 写回流程。
 */

export const DEFAULT_PROJECT_PATH = 'D:\\策划\\项目.json';

export interface FakeHost {
  bridge: DesktopBridge;
  /** "磁盘"上的文件：路径 → 内容 */
  disk: Map<string, string>;
  /** 每一次写盘的内容，用来断言"改动直接存进了 json" */
  written: { filePath: string; content: string }[];
  /** 下一次「新建项目文件」对话框返回的路径；null 表示用户取消 */
  nextNewPath: string | null;
  /** 下一次「打开项目文件」对话框返回的内容；null 表示用户取消 */
  nextOpen: { filePath: string; content: string } | null;
  /** 记录「新建 / 打开」被点了几次 */
  picks: string[];
}

/** 装上假宿主：files 是"磁盘"，sessionPath 是"上次打开的项目路径" */
export function installFakeHost(
  files: Record<string, string> = {},
  sessionPath: string | null = null,
): FakeHost {
  const host: FakeHost = {
    disk: new Map(Object.entries(files)),
    written: [],
    nextNewPath: null,
    nextOpen: null,
    picks: [],
    bridge: undefined as unknown as DesktopBridge,
  };

  host.bridge = {
    pickNewProjectPath: vi.fn(async () => {
      host.picks.push('new');
      return host.nextNewPath;
    }),
    pickProject: vi.fn(async () => {
      host.picks.push('open');
      return host.nextOpen;
    }),
    readProject: vi.fn(async (filePath: string) => host.disk.get(filePath) ?? null),
    writeProject: vi.fn(async (filePath: string, content: string) => {
      host.disk.set(filePath, content);
      host.written.push({ filePath, content });
    }),
    exportFile: vi.fn(async () => null),
    revealFile: vi.fn(async () => undefined),
  };

  window.storymakerDesktop = host.bridge;
  saveSessionPath(sessionPath);
  return host;
}

/** 项目文件里已经有内容，启动时会被自动读回 */
export function seedProjectFile(
  content: string,
  filePath: string = DEFAULT_PROJECT_PATH,
): FakeHost {
  return installFakeHost({ [filePath]: content }, filePath);
}

/** 项目文件是空的：走进界面后看到的是默认第一行对话 */
export function seedEmptyProject(filePath: string = DEFAULT_PROJECT_PATH): FakeHost {
  return seedProjectFile(JSON.stringify(createEmptyProject()), filePath);
}

export function clearFakeHost(): void {
  delete window.storymakerDesktop;
}

/** 项目名称输入框：它出现就说明门槛已经过去、界面可编辑了 */
const PROJECT_NAME_TITLE = '项目名称，也是导出文件名';

/** 渲染 App 并等到门槛过去（项目文件读回来、编辑界面出现） */
export async function renderApp() {
  const view = render(<App />);
  await screen.findByTitle(PROJECT_NAME_TITLE);
  return view;
}
