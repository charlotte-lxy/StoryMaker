/**
 * 谁在协作：这份名单纯靠客户端之间的心跳攒出来——服务端只转发，不给成员表。
 *
 * 全是纯函数：「收到一条心跳」和「剔除掉线的」各是一个能单独测的动作，
 * 计时器和 React 状态交给调用方。
 */

import type { PresenceInfo } from './protocol';

export interface Collaborator extends PresenceInfo {
  clientId: string;
  /** 最后一次收到心跳的时刻（毫秒） */
  lastSeen: number;
  /** 正在看的模块 */
  module: string;
}

/** 心跳间隔：够勤快，又不至于把广播刷爆 */
export const PRESENCE_INTERVAL_MS = 5000;

/** 超过这么久没心跳就当掉线。留了两个心跳周期的余量，网络抖一下不至于被误踢 */
export const PRESENCE_TIMEOUT_MS = 15000;

/** 收到一条心跳：更新已有的人，或者把新人加进来 */
export function upsertCollaborator(
  list: readonly Collaborator[],
  clientId: string,
  presence: PresenceInfo,
  now: number,
): Collaborator[] {
  const next = list.filter((item) => item.clientId !== clientId);
  next.push({
    clientId,
    name: presence.name,
    color: presence.color,
    module: presence.module ?? '',
    lastSeen: now,
  });
  return next;
}

/** 剔除掉线的；顺便排个序，免得列表每跳一次就换个位置 */
export function pruneCollaborators(
  list: readonly Collaborator[],
  now: number,
  timeoutMs: number = PRESENCE_TIMEOUT_MS,
): Collaborator[] {
  return list
    .filter((item) => now - item.lastSeen < timeoutMs)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.clientId.localeCompare(b.clientId));
}

/** 名单上显示的名字：没填过就是「未命名用户」 */
export function displayNameOf(presence: PresenceInfo): string {
  const name = presence.name.trim();
  return name === '' ? '未命名用户' : name;
}

/**
 * 圆圈里显示的那个字：名字的第一个字。
 *
 * 用展开而不是 name[0]：名字要是以 emoji 之类的代理对字符开头，
 * 按下标取会切出半个码元，显示成乱码。
 */
export function initialOf(presence: PresenceInfo): string {
  const name = presence.name.trim();
  if (name === '') return '?';
  return [...name][0];
}
