/**
 * 脚本块：左侧栏下方那一列可以拖的方块。
 *
 * 拖到右侧列表里就插入一行对应的数据，三种块与三种行类型一一对应。
 */

import type { LineKind } from '../core/types';

/** 拖拽时用的数据类型标记，用来和「行内拖动排序」区分开 */
export const BLOCK_MIME = 'application/x-storymaker-block';

export interface ScriptBlock {
  kind: LineKind;
  name: string;
  /** 一句话说明这个块是干什么的，显示在块名下面 */
  note: string;
}

export const SCRIPT_BLOCKS: readonly ScriptBlock[] = [
  { kind: '对话', name: '对话', note: '填写角色的台词' },
  { kind: '选项', name: '选项', note: '弹出选项框，跳转到其他对话上' },
  { kind: '指令', name: '指令', note: '修改游戏数据或播放演出效果' },
];

/** 这次拖拽是不是从脚本块区发起的（dragover 阶段只能看类型，读不到数据） */
export function isBlockDrag(transfer: DataTransfer | null): boolean {
  return transfer !== null && transfer.types.includes(BLOCK_MIME);
}

/** 取这次拖拽带过来的块类型；不是脚本块拖拽时返回 null */
export function blockKindOf(transfer: DataTransfer | null): LineKind | null {
  if (transfer === null || !transfer.types.includes(BLOCK_MIME)) return null;
  const kind = transfer.getData(BLOCK_MIME);
  return kind === '' ? null : (kind as LineKind);
}
