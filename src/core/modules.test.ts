import { describe, expect, it } from 'vitest';

import { MODULES, engineOf, isModuleId, modulesForEngine, visibleModules } from './modules';

describe('模块清单', () => {
  it('老项目没有 engine 字段时按 Unreal 处理，侧边栏还是原来那八个模块', () => {
    expect(engineOf({})).toBe('unreal');
    expect(modulesForEngine('unreal').map((item) => item.id)).toEqual([
      'story',
      'sounds',
      'items',
      'quests',
      'images',
      'command',
      'battle',
      'locale',
    ]);
  });

  it('Godot 侧只给共用的五个模块加 MCR 的五张表', () => {
    expect(modulesForEngine('godot').map((item) => item.id)).toEqual([
      'story',
      'sounds',
      'images',
      'command',
      'locale',
      'mcr_items',
      'mcr_characters',
      'mcr_rooms',
      'mcr_projects',
      'mcr_battle',
    ]);
  });

  it('项目里关掉的模块不再出现；必需模块关不掉', () => {
    const ids = visibleModules({
      engine: 'godot',
      disabledModules: ['sounds', 'mcr_rooms', 'story'],
    }).map((item) => item.id);

    expect(ids).not.toContain('sounds');
    expect(ids).not.toContain('mcr_rooms');
    expect(ids).toContain('story');
  });

  it('MCR 模块和 Unreal 的同名模块是两条独立记录', () => {
    const items = MODULES.find((item) => item.id === 'items');
    const mcrItems = MODULES.find((item) => item.id === 'mcr_items');
    expect(items?.engines).toEqual(['unreal']);
    expect(mcrItems?.engines).toEqual(['godot']);
    expect(mcrItems?.label).toBe('物品（MCR）');
  });

  it('只认清单里的模块 ID', () => {
    expect(isModuleId('mcr_items')).toBe(true);
    expect(isModuleId('nope')).toBe(false);
    expect(isModuleId(undefined)).toBe(false);
  });
});
