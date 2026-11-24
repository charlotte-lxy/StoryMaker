// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_STORY_LAYOUT,
  clampOutlineWidth,
  loadSessionPath,
  loadSettings,
  loadStoryLayout,
  outlineWidthLimit,
  saveSessionPath,
  saveSettings,
  saveStoryLayout,
} from './prefs';

beforeEach(() => {
  window.localStorage.clear();
});

describe('设置与「上次打开的项目」的记忆', () => {
  it('什么都没存过时给默认值：自动保存开、浅色主题、没有上次的项目', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings().autoSave).toBe(true);
    expect(loadSessionPath()).toBeNull();
  });

  it('设置存进去能原样读回来', () => {
    saveSettings({ autoSave: false, theme: 'dark' });
    expect(loadSettings()).toEqual({ autoSave: false, theme: 'dark' });
  });

  it('本地数据损坏或字段缺失时退回默认值，不抛错', () => {
    window.localStorage.setItem('storymaker.settings.v1', '{这不是 JSON');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    // 只存了主题、主题值还是没见过的：两项都退回默认
    window.localStorage.setItem('storymaker.settings.v1', JSON.stringify({ theme: '紫色' }));
    expect(loadSettings()).toEqual({ autoSave: true, theme: 'light' });
  });

  it('记住上次打开的项目路径，传 null 表示清空', () => {
    saveSessionPath('D:\\策划\\序章.json');
    expect(loadSessionPath()).toBe('D:\\策划\\序章.json');

    saveSessionPath(null);
    expect(loadSessionPath()).toBeNull();
  });

  it('剧情模块合并面板默认 560px，拖过之后记住', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    try {
      expect(loadStoryLayout()).toEqual(DEFAULT_STORY_LAYOUT);

      saveStoryLayout({ outlineWidth: 640 });
      expect(loadStoryLayout()).toEqual({ outlineWidth: 640 });
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
    }
  });

  it('合并面板宽度会被夹在合理区间，坏数据退回默认值', () => {
    expect(clampOutlineWidth(1)).toBe(360);
    // 上限跟着窗口宽度走：jsdom 窗口 1024 宽 - 560
    expect(clampOutlineWidth(9999)).toBe(outlineWidthLimit());
    expect(clampOutlineWidth(Number.NaN)).toBe(DEFAULT_STORY_LAYOUT.outlineWidth);

    saveStoryLayout({ outlineWidth: 9999 });
    expect(loadStoryLayout()).toEqual({ outlineWidth: outlineWidthLimit() });

    window.localStorage.setItem('storymaker.story-layout.v1', '不是 JSON');
    expect(loadStoryLayout()).toEqual(DEFAULT_STORY_LAYOUT);
  });

  it('窗口够宽时面板能拖得比原来更宽', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
    try {
      expect(outlineWidthLimit()).toBe(1040);
      expect(clampOutlineWidth(9999)).toBe(1040);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
    }
  });
});
