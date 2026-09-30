/**
 * 脚本块：左侧栏下方那一列可以拖的方块。
 *
 * 拖到右侧列表里就插入一行对应的数据。「跳转到段落」也是往列表里插一行「指令」，
 * 只是它的指令内容由所选段落现拼，所以在块这一层单独算一种。
 */

import type { LineKind } from '../core/types';

/** 拖拽时用的数据类型标记，用来和「行内拖动排序」区分开 */
export const BLOCK_MIME = 'application/x-storymaker-block';

/**
 * 从对话列表里拖"勾中的行"时用的标记。
 *
 * 拖到流程图上的段落块上，就等于把这几行「移动至」那个段落（需求：拖动已选中的条目
 * 到段落节点 = 移动至）。列表内部的排序拖动带的是这个类型 + 原有的拖拽行状态。
 */
export const LINES_MIME = 'application/x-storymaker-lines';

/** 块的名字。三种行类型直接沿用行类型名，另两种也是往列表里插「指令」行，各自单独一个 */
export type BlockId = LineKind | '跳转到段落' | '特殊演出效果';

export interface ScriptBlock {
  id: BlockId;
  name: string;
  /** 一句话说明这个块是干什么的，显示在块名下面 */
  note: string;
}

export const SCRIPT_BLOCKS: readonly ScriptBlock[] = [
  { id: '对话', name: '对话', note: '填写角色的台词' },
  { id: '选项', name: '选项', note: '弹出选项框，跳转到其他对话上' },
  { id: '指令', name: '指令', note: '修改游戏数据或播放演出效果' },
  { id: '跳转到段落', name: '跳转到段落', note: '直接播另一个段落的第一句' },
  { id: '特殊演出效果', name: '特殊演出效果', note: '拼一条「特殊# 指令名称」的指令' },
];

/** 这次拖拽是不是从脚本块区发起的（dragover 阶段只能看类型，读不到数据） */
export function isBlockDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && transfer.types.includes(BLOCK_MIME);
}

/** 取这次拖拽带过来的块类型；不是脚本块拖拽时返回 null */
export function blockKindOf(transfer: DataTransfer | null): BlockId | null {
  if (transfer === null || !transfer.types.includes(BLOCK_MIME)) return null;
  const kind = transfer.getData(BLOCK_MIME);
  return kind === '' ? null : (kind as BlockId);
}

/** 这次拖拽是不是"勾中的对话行"（拖到流程图段落块上 = 移动至） */
export function isLinesDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && transfer.types.includes(LINES_MIME);
}
