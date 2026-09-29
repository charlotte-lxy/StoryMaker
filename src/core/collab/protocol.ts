/**
 * 协作同步的线协议。
 *
 * 外挂服务端（SocketServer.exe）只会把收到的消息原样转发给所有连接，不做任何解析，
 * 所以全部语义都定义在这里：一条「改动」怎么表达、怎么判断两边有没有撞车。
 *
 * 核心约定：所有定位都走 uid，不走数组下标——下标会随插入/删除漂移，
 * 一旦漂移，patch 就会改到别的条目上。这也正是数据模型坚持「uid 稳定」的原因。
 */

/** 条目路径，段之间用 / 分隔，例如 chapters/ch1/groups/g1/lines/l3 */
export type TargetPath = string;

/** 集合路径，例如 chapters/ch1/groups */
export type CollectionPath = string;

/** 改某个具体字段（最常用的一种） */
export interface FieldPatch {
  kind: 'field';
  /** 目标条目；空串表示 Project 根（比如改项目名） */
  target: TargetPath;
  /** 字段路径，点分层级：name、text.zh、fixedValues */
  field: string;
  /** 改之前的值，用来判断两边是不是基于同一起点 */
  oldValue: unknown;
  value: unknown;
}

/** 往某个集合里加一条（item 必须带 uid） */
export interface AddPatch {
  kind: 'add';
  collection: CollectionPath;
  item: { uid: string } & Record<string, unknown>;
}

/** 删掉一条 */
export interface RemovePatch {
  kind: 'remove';
  target: TargetPath;
  oldValue: unknown;
}

/** 调整集合里的顺序（拖拽排序） */
export interface ReorderPatch {
  kind: 'reorder';
  collection: CollectionPath;
  oldOrder: string[];
  order: string[];
}

export type Patch = FieldPatch | AddPatch | RemovePatch | ReorderPatch;

/**
 * 一条没能自动应用的改动。
 *
 * 只在「本地和对方都动过同一处」时产生——无冲突的会直接合并，不会打扰人。
 */
export interface Conflict {
  patch: Patch;
  /** 本地现在是什么值 */
  localValue: unknown;
  /**
   * both-changed  : 我也改过这一处，得人来选保留哪边
   * target-missing: 目标条目在本地已经不存在了（多半是被删了）
   */
  reason: 'both-changed' | 'target-missing';
}

/**
 * 哪些位置是「装着带 uid 条目的集合」。
 *
 * diff 时按它逐集合比对，apply 时按它找目标。带 * 的段表示「遍历上一层的每一条」。
 * 新增集合时记得补进这张表，否则那部分数据不会被同步。
 */
export const COLLECTIONS: readonly string[] = [
  'characters',
  'items',
  'quests',
  'images',
  'sounds',
  'commands',
  'chapters',
  'chapters/*/groups',
  'chapters/*/groups/*/lines',
  'chapters/*/groups/*/options',
  'uiTexts',
  'exportSettings',
  'battle/attributes',
  'battle/effects',
  'battle/effects/*/modifiers',
  'battle/skills',
  'battle/skills/*/parameters',
  'battle/events',
  'battle/characters',
  'battle/characters/*/attributes',
  'battle/weapons',
  'battle/weapons/*/modifiers',
];

/**
 * 只能整体当一个字段同步的部分。
 *
 * variables 里的记录没有 uid（见 types.ts 的 VariableDecl），没法按条目定位，
 * 所以整个数组算一个字段；好在这张表目前还没有编辑界面，冲突概率极低。
 */
export const WHOLE_FIELDS: readonly string[] = [
  'name',
  'variables',
  'battle.skillClassPrefix',
  'battle.effectClassPrefix',
];

/** 把路径拆成段 */
export function splitPath(path: string): string[] {
  return path === '' ? [] : path.split('/');
}

/** 把段拼回路径 */
export function joinPath(segments: readonly string[]): string {
  return segments.join('/');
}

/**
 * 客户端之间通过外挂服务端广播的消息。
 *
 * 服务端只做转发（而且会把你自己的消息也回显给你），所以收到消息后第一件事
 * 就是拿 clientId 把自己发的过滤掉，见 client.ts。
 */
export interface CollabMessage {
  type: 'hello' | 'snapshot' | 'patch' | 'resolve' | 'bye';
  clientId: string;
  /** Lamport 时钟：本地改动时自增，收到别人的消息时取 max 再自增 */
  clock: number;
  /** type=snapshot 时带完整文档 */
  doc?: unknown;
  /** type=patch 时带改动 */
  patches?: Patch[];
}

/** 连接状态。offline 不等于坏掉——那一律按纯本地用，这是设计的一部分 */
export type CollabStatus = 'offline' | 'connecting' | 'online';
