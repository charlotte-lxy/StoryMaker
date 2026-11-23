/**
 * 编辑器模块清单：哪一组模块、哪个引擎能用、能不能关。
 *
 * 一个项目同时只面向一个引擎（`Project.engine`）：Unreal 那边是剧情 / 物品 / 任务 / 战斗这一套，
 * Godot（MCR）那边保留通用的剧情 / 音效 / 立绘 / 条件与指令 / 本地化，另加自己的一整套数据。
 * 两边的同名模块数据是分开的，别把 `mcr_items` 当成 `items` 的换皮。
 *
 * 模块关掉只表示「这个项目不用它」：侧边栏藏起来、不参与校验和导出，数据仍在项目文件里。
 */

import type { EngineKind, ModuleId, Project } from './types';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** 侧边栏上的图标，单字符 */
  icon: string;
  /** 在哪些引擎下出现 */
  engines: readonly EngineKind[];
  /**
   * 必需模块：项目里关不掉。
   *
   * 剧情、条件与指令、本地化是编辑器的主干，关掉之后剩下几个表也没法用。
   */
  required?: boolean;
  /** 侧边栏排序，小的在上 */
  order: number;
}

const BOTH = ['unreal', 'godot'] as const;

export const MODULES: readonly ModuleDef[] = [
  { id: 'story', label: '剧情', icon: '✎', engines: BOTH, required: true, order: 10 },
  { id: 'sounds', label: '音效', icon: '♪', engines: BOTH, order: 20 },
  { id: 'items', label: '物品', icon: '◆', engines: ['unreal'], order: 25 },
  { id: 'quests', label: '任务', icon: '✓', engines: ['unreal'], order: 26 },
  { id: 'images', label: '立绘', icon: '▣', engines: BOTH, order: 30 },
  { id: 'command', label: '条件与指令', icon: '⌘', engines: BOTH, required: true, order: 40 },
  { id: 'battle', label: '战斗', icon: '⚔', engines: ['unreal'], order: 50 },
  { id: 'locale', label: '本地化', icon: '文', engines: BOTH, required: true, order: 60 },
  { id: 'mcr_items', label: '物品（MCR）', icon: '◆', engines: ['godot'], order: 70 },
  { id: 'mcr_characters', label: '角色（MCR）', icon: '☺', engines: ['godot'], order: 72 },
  { id: 'mcr_rooms', label: '房间（MCR）', icon: '⌂', engines: ['godot'], order: 74 },
  { id: 'mcr_projects', label: '工作项目（MCR）', icon: '▤', engines: ['godot'], order: 76 },
  { id: 'mcr_battle', label: '战斗（MCR）', icon: '⚔', engines: ['godot'], order: 78 },
];

const MODULE_IDS: readonly ModuleId[] = MODULES.map((item) => item.id);

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}

/** 项目面向的引擎；老项目没有 engine 字段，按 Unreal 处理 */
export function engineOf(project: Pick<Project, 'engine'>): EngineKind {
  return project.engine === 'godot' ? 'godot' : 'unreal';
}

/** 某个引擎下的全部候选模块（还没扣掉项目里关掉的） */
export function modulesForEngine(engine: EngineKind): ModuleDef[] {
  return MODULES.filter((item) => item.engines.includes(engine));
}

/** 这个项目实际显示的模块：引擎候选集 − 项目里关掉的（必需模块关不掉） */
export function visibleModules(project: Pick<Project, 'engine' | 'disabledModules'>): ModuleDef[] {
  const disabled = new Set(project.disabledModules ?? []);
  return modulesForEngine(engineOf(project)).filter((item) => item.required === true || !disabled.has(item.id));
}

export function isModuleVisible(
  project: Pick<Project, 'engine' | 'disabledModules'>,
  id: ModuleId,
): boolean {
  return visibleModules(project).some((item) => item.id === id);
}

export function moduleById(id: ModuleId): ModuleDef | undefined {
  return MODULES.find((item) => item.id === id);
}
