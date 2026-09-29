import { describe, expect, it } from 'vitest';

import { parseBase, serializeBase } from './sidecar';
import type { SyncBase } from './session';

describe('sidecar 的序列化', () => {
  it('写出去再读回来，内容不变', () => {
    const base: SyncBase = { doc: { version: 1, name: '项目', chapters: [] }, clock: 42 };
    const restored = parseBase(serializeBase(base));

    expect(restored).toEqual(base);
  });

  it('没有文件（null）或空内容时当作没有基准', () => {
    expect(parseBase(null)).toBeNull();
    expect(parseBase('')).toBeNull();
    expect(parseBase('   ')).toBeNull();
  });

  it('内容坏掉时当作没有基准，不抛错', () => {
    expect(parseBase('这不是 JSON')).toBeNull();
    expect(parseBase('{"doc":')).toBeNull();
    expect(parseBase('[1,2,3]')).toBeNull();
    expect(parseBase('"字符串"')).toBeNull();
  });

  it('缺 doc 字段的当坏数据', () => {
    expect(parseBase('{"clock":7}')).toBeNull();
  });

  it('doc 为 null 也算有 doc（可能是空项目）', () => {
    expect(parseBase('{"doc":null,"clock":3}')).toEqual({ doc: null, clock: 3 });
  });

  it('clock 缺失或不是数字时兜底成 0', () => {
    expect(parseBase('{"doc":{}}')).toEqual({ doc: {}, clock: 0 });
    expect(parseBase('{"doc":{},"clock":"七"}')).toEqual({ doc: {}, clock: 0 });
    expect(parseBase('{"doc":{},"clock":null}')).toEqual({ doc: {}, clock: 0 });
  });
});
