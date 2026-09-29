/**
 * 冲突裁决与首次对账：把「人在界面上点了哪个按钮」变成「文档上的结果」。
 *
 * 纯函数，跟界面无关——界面只负责告诉这里用户选了哪一边，怎么落地由这里决定，
 * 于是这些判断全都能单独测。
 */

import { applyPatchForced, mergeByUnion } from './merge';
import type { Conflict } from './protocol';

/** 用户在冲突面板上对某一条冲突的选择 */
export type ConflictChoice = 'mine' | 'theirs';

/**
 * 按选择把冲突落到文档上。
 *
 * 选 mine 的什么都不用做——文档里本来就是我的值；选 theirs 的强制应用对方的 patch。
 */
export function resolveConflicts<T>(
  doc: T,
  conflicts: readonly Conflict[],
  choices: readonly ConflictChoice[],
): T {
  let next = doc;
  conflicts.forEach((conflict, index) => {
    if (choices[index] === 'theirs') {
      next = applyPatchForced(next, conflict.patch);
    }
  });
  return next;
}

/** 首次对账时用户的四种选择 */
export type FirstContactChoice = 'remote' | 'local' | 'both' | 'later';

export interface FirstContactResult<T> {
  doc: T;
  /** 要不要把这份结果广播出去（让服务端那边也改成这个） */
  broadcast: boolean;
}

/**
 * 两边都有一份内容、又没有共同起点时的处理。
 *
 * 注意 `later`：用户选了「先不同步」，那就本机原样不动、也不广播，
 * 由上层负责断开连接——这条路径必须真的什么都不做，否则「先不同步」就名不副实。
 */
export function resolveFirstContact<T>(
  localDoc: T,
  remoteDoc: T,
  choice: FirstContactChoice,
): FirstContactResult<T> {
  if (choice === 'remote') {
    return { doc: remoteDoc, broadcast: false };
  }
  if (choice === 'local') {
    return { doc: localDoc, broadcast: true };
  }
  if (choice === 'both') {
    return { doc: mergeByUnion(localDoc, remoteDoc) as T, broadcast: true };
  }
  return { doc: localDoc, broadcast: false };
}
