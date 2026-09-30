// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { clearFakeHost, renderApp, seedProjectFile } from './testing/app-harness';

const dataCandidates = ['testinput/初始数据.json', 'reference/初始数据.json', '初始数据.json'];
const dataPath = dataCandidates
  .map((item) => resolve(process.cwd(), item))
  .find((item) => existsSync(item));
const hasData = dataPath !== undefined;

/** 把真实样例当成"上次打开的项目文件"，启动时按路径读回来 */
function seed(): void {
  if (dataPath === undefined) return;
  seedProjectFile(readFileSync(dataPath, 'utf8'));
}

const rail = () => screen.getByRole('navigation');

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  clearFakeHost();
});

it.skipIf(!hasData)('载入导入数据后界面不会崩', async () => {
  seed();
  await expect(renderApp()).resolves.toBeTruthy();
});

it.skipIf(!hasData)('载入导入数据后能渲染出剧情行', async () => {
  seed();
  await renderApp();
  // 段落块与段落标题来自本章流程，列表里则是每行左侧的段内序号
  expect(screen.getAllByText('段落 001').length).toBeGreaterThan(0);
  expect(screen.getAllByText('选项列表').length).toBeGreaterThan(0);
});

it.skipIf(!hasData)('导入数据里的「指令」行能渲染出指令下拉', async () => {
  seed();
  await renderApp();
  // 「指令」行一行只放一条指令，字典里能选的就只留下拉
  expect(screen.getAllByTitle('选择指令').length).toBeGreaterThan(0);
  // 老的「＋ 新增指令」按钮已经没有了
  expect(screen.queryByText('＋ 新增指令')).toBeNull();
});

it.skipIf(!hasData)('导入数据后逐个模块切换都不会崩', async () => {
  seed();
  await renderApp();
  for (const label of ['角色', '音效', '物品', '任务', '立绘', '条件与指令', '本地化', '剧情']) {
    expect(() => fireEvent.click(within(rail()).getByText(label))).not.toThrow();
  }
});

it.skipIf(!hasData)('渲染期间不应有 React 警告或错误', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  seed();
  await renderApp();
  expect(spy).not.toHaveBeenCalled();
});

it.skipIf(!hasData)('导入后展开选项编辑区不会崩', async () => {
  seed();
  await renderApp();
  // 段落 001 的最后一行是带两个选项的「选项」行
  expect(screen.getAllByText('选项列表').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Dia_ch01_001-22A').length).toBeGreaterThan(0);
  expect(screen.getAllByTitle('第一级：目标段落').length).toBeGreaterThan(0);
});
