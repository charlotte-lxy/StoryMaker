import { describe, expect, it } from 'vitest';

import {
  displayNameOf,
  PRESENCE_TIMEOUT_MS,
  pruneCollaborators,
  upsertCollaborator,
  type Collaborator,
} from './presence';

function person(clientId: string, name: string, lastSeen: number): Collaborator {
  return { clientId, name, color: 'red', lastSeen };
}

describe('协作名单', () => {
  it('收到陌生人的心跳：加进名单', () => {
    const list = upsertCollaborator([], 'a', { name: '小王', color: 'red' }, 1000);

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ clientId: 'a', name: '小王', color: 'red', lastSeen: 1000 });
  });

  it('同一个人再喊一次：更新而不是多出一条', () => {
    const first = upsertCollaborator([], 'a', { name: '小王', color: 'red' }, 1000);
    const second = upsertCollaborator(first, 'a', { name: '小王', color: 'blue' }, 2000);

    expect(second).toHaveLength(1);
    expect(second[0].color).toBe('blue');
    expect(second[0].lastSeen).toBe(2000);
  });

  it('改名和改色都会被别人看到', () => {
    const first = upsertCollaborator([], 'a', { name: '', color: 'red' }, 1000);
    const second = upsertCollaborator(first, 'a', { name: '小李', color: 'purple' }, 2000);

    expect(second[0].name).toBe('小李');
    expect(second[0].color).toBe('purple');
  });

  it('超时没心跳就当掉线剔掉', () => {
    const list = [person('a', '小王', 1000)];

    expect(pruneCollaborators(list, 1000 + PRESENCE_TIMEOUT_MS - 1)).toHaveLength(1);
    expect(pruneCollaborators(list, 1000 + PRESENCE_TIMEOUT_MS)).toHaveLength(0);
  });

  it('名单按名字排序，位置不会每跳一次就乱一下', () => {
    const list = [person('c', '小张', 1000), person('a', '小王', 1000), person('b', '小李', 1000)];
    const sorted = pruneCollaborators(list, 1000).map((item) => item.name);

    expect(sorted).toEqual(['小李', '小王', '小张']);
  });

  it('没填名字就显示「未命名用户」', () => {
    expect(displayNameOf({ name: '', color: 'red' })).toBe('未命名用户');
    expect(displayNameOf({ name: '   ', color: 'red' })).toBe('未命名用户');
    expect(displayNameOf({ name: '小王', color: 'red' })).toBe('小王');
  });
});
