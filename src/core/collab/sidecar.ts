/**
 * 协作元数据的落盘格式。
 *
 * 存在项目文件旁边的 <项目>.sync 里，内容是「我确信所有在线客户端都已知道的那一版
 * 文档」加一个 Lamport 时钟。
 *
 * 这个文件必须容错：读不出来就当没有（等于第一次参与协作），绝不能因为一个坏文件
 * 让人打不开项目——它是辅助数据，不是项目本身。
 */

import type { SyncBase } from './session';

export function serializeBase(base: SyncBase): string {
  return JSON.stringify(base);
}

/** 解析 .sync；不是合法内容一律返回 null，调用方按"没有基准"处理 */
export function parseBase(text: string | null): SyncBase | null {
  if (text === null || text.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'doc')) return null;

  const clock =
    typeof record.clock === 'number' && Number.isFinite(record.clock) ? record.clock : 0;
  return { doc: record.doc, clock };
}
