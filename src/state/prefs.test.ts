// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_STORY_SPLIT,
  clampStorySplit,
  loadSessionPath,
  loadSettings,
  loadStorySplit,
  saveSessionPath,
  saveSettings,
  saveStorySplit,
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

  it('分栏宽度默认各一半，拖过之后记住', () => {
    expect(loadStorySplit()).toBe(DEFAULT_STORY_SPLIT);

    saveStorySplit(0.3);
    expect(loadStorySplit()).toBe(0.3);
  });

  it('分栏宽度会被夹在 15%~85% 之间，坏数据退回默认值', () => {
    expect(clampStorySplit(0.01)).toBe(0.15);
    expect(clampStorySplit(0.99)).toBe(0.85);
    expect(clampStorySplit(Number.NaN)).toBe(DEFAULT_STORY_SPLIT);

    saveStorySplit(5);
    expect(loadStorySplit()).toBe(0.85);

    window.localStorage.setItem('storymaker.story-split.v1', '不是 JSON');
    expect(loadStorySplit()).toBe(DEFAULT_STORY_SPLIT);
  });
});
