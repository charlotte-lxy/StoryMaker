/**
 * 协作合并内核：算出「我改了什么」，以及把别人发来的改动安全地并进来。
 *
 * 两条原则：
 *
 *   1. 定位一律走 uid。数组下标会随插入/删除漂移，漂移之后 patch 就改到别的条目上了。
 *   2. 合并只在这两种情况下动手——本地值等于对方 patch 的 oldValue（我没动过），
 *      或者本地值已经等于对方的新值（重复投递）。其余一律记成冲突交给人来选，
 *      绝不猜。宁可多问一句，也不悄悄丢掉谁的改动。
 *
 * 全部是纯函数：不改传入的对象，不碰网络，不碰界面，可以单独测。
 */

import {
  COLLECTIONS,
  WHOLE_FIELDS,
  joinPath,
  splitPath,
  type AddPatch,
  type Conflict,
  type FieldPatch,
  type Patch,
  type ReorderPatch,
} from './protocol';

/** 带 uid 的条目 */
interface UidItem {
  uid: string;
  [key: string]: unknown;
}

export interface MergeResult<T = unknown> {
  /** 合并后的文档（新对象，传入的那个没被改动） */
  doc: T;
  /** 没能自动应用、需要人来裁决的改动 */
  conflicts: Conflict[];
  applied: number;
  skipped: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 深度比较：项目数据都是纯 JSON，按值比对即可 */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 数组元素带 uid 才算「集合」，用来把嵌套集合和普通标量数组区分开 */
function isUidCollection(value: unknown): value is UidItem[] {
  return Array.isArray(value) && value.every((item) => isPlainObject(item) && typeof item.uid === 'string');
}

// ---------- 按 uid 取/放 ----------

/** 沿路径取值；路径上遇到数组就按 uid 找那一条，不按下标 */
function getByPath(root: unknown, segments: readonly string[]): unknown {
  let node: unknown = root;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      node = node.find((item) => isPlainObject(item) && item.uid === segment);
    } else {
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return node;
}

// ---------- 字段路径（点分层级） ----------

function getFieldValue(target: unknown, field: string): unknown {
  if (field === '') return target;
  let node: unknown = target;
  for (const part of field.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function setFieldValue(target: unknown, field: string, value: unknown): void {
  const parts = field.split('.');
  let node = target as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const child = node[part];
    if (!isPlainObject(child)) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

// ---------- 集合模板展开 ----------

export interface ResolvedCollection {
  /** 实际路径，模板里的 * 已换成具体 uid */
  path: string;
  items: UidItem[];
}

function walkTemplate(node: unknown, segments: readonly string[], soFar: string[], out: ResolvedCollection[]): void {
  if (segments.length === 0) {
    if (isUidCollection(node)) out.push({ path: joinPath(soFar), items: node });
    return;
  }
  const [head, ...rest] = segments;
  if (head === '*') {
    if (!Array.isArray(node)) return;
    for (const item of node) {
      if (isPlainObject(item) && typeof item.uid === 'string') {
        walkTemplate(item, rest, [...soFar, item.uid], out);
      }
    }
    return;
  }
  if (isPlainObject(node)) {
    walkTemplate(node[head], rest, [...soFar, head], out);
  }
}

/** 把一个集合模板（可能带 *）展开成本文档里实际存在的那些集合 */
export function resolveCollections(doc: unknown, template: string): ResolvedCollection[] {
  const out: ResolvedCollection[] = [];
  walkTemplate(doc, splitPath(template), [], out);
  return out;
}

// ---------- diff：算出我改了什么 ----------

/**
 * 细粒度地比对一个字段：对象会被拆到叶子，于是 text 会变成 text.zh / text.en / text.ja，
 * 两个人分别改中英文就不算冲突了。
 */
function diffValue(target: string, field: string, before: unknown, after: unknown): Patch[] {
  if (deepEqual(before, after)) return [];
  if (isPlainObject(before) && isPlainObject(after) && !isUidCollection(before) && !isUidCollection(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out: Patch[] = [];
    for (const key of keys) {
      out.push(...diffValue(target, field === '' ? key : `${field}.${key}`, before[key], after[key]));
    }
    return out;
  }
  return [{ kind: 'field', target, field, oldValue: before, value: after }];
}

function diffItem(parentPath: string, before: UidItem, after: UidItem): Patch[] {
  const target = `${parentPath}/${before.uid}`;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Patch[] = [];
  for (const key of keys) {
    if (key === 'uid') continue;
    // 嵌套集合交给它自己的模板处理，这里不能重复报
    if (isUidCollection(before[key]) || isUidCollection(after[key])) continue;
    out.push(...diffValue(target, key, before[key], after[key]));
  }
  return out;
}

/**
 * 算出 base → current 之间的全部改动。
 *
 * base 是「上次同步完成时的状态」，current 是现在。算出来的 patch 就是「我改了什么」，
 * 可以直接广播给其他人。
 */
export function diffProject(base: unknown, current: unknown): Patch[] {
  const patches: Patch[] = [];

  for (const field of WHOLE_FIELDS) {
    const before = getFieldValue(base, field);
    const after = getFieldValue(current, field);
    patches.push(...diffValue('', field, before, after));
  }

  for (const template of COLLECTIONS) {
    const beforeMap = new Map(resolveCollections(base, template).map((c) => [c.path, c.items]));
    const afterMap = new Map(resolveCollections(current, template).map((c) => [c.path, c.items]));

    for (const [path, beforeItems] of beforeMap) {
      const afterItems = afterMap.get(path);
      // 整个集合都没了（比如章节被删），那是上层的事，这里跳过
      if (afterItems === undefined) continue;

      const beforeUids = beforeItems.map((item) => item.uid);
      const afterUids = afterItems.map((item) => item.uid);

      for (const item of beforeItems) {
        if (!afterUids.includes(item.uid)) {
          patches.push({ kind: 'remove', target: `${path}/${item.uid}`, oldValue: item });
        }
      }

      for (const item of afterItems) {
        if (!beforeUids.includes(item.uid)) {
          patches.push({ kind: 'add', collection: path, item: clone(item) });
        }
      }

      for (const beforeItem of beforeItems) {
        const afterItem = afterItems.find((item) => item.uid === beforeItem.uid);
        if (afterItem === undefined) continue;
        patches.push(...diffItem(path, beforeItem, afterItem));
      }

      // 只比「两边都还在」的那些条目的相对顺序：纯新增/删除也会让 uid 列表变长变短，
      // 但那不是重排，报成 reorder 只会给对面制造假冲突。
      const sharedBefore = beforeUids.filter((uid) => afterUids.includes(uid));
      const sharedAfter = afterUids.filter((uid) => beforeUids.includes(uid));
      if (!deepEqual(sharedBefore, sharedAfter)) {
        patches.push({ kind: 'reorder', collection: path, oldOrder: sharedBefore, order: sharedAfter });
      }
    }
  }

  return patches;
}

// ---------- apply：把别人的改动并进来 ----------

function findCollection(root: unknown, collectionPath: string): UidItem[] | null {
  const node = getByPath(root, splitPath(collectionPath));
  return isUidCollection(node) ? node : null;
}

/**
 * 把一批 patch 应用到 doc 上。
 *
 * 返回值里的 doc 是新对象；conflicts 是要拿去问人的那些改动。
 */
export function applyPatches<T>(doc: T, patches: readonly Patch[]): MergeResult<T> {
  const next = clone(doc) as Record<string, unknown>;
  const conflicts: Conflict[] = [];
  let applied = 0;
  let skipped = 0;

  for (const patch of patches) {
    if (patch.kind === 'field') {
      const target = patch.target === '' ? next : getByPath(next, splitPath(patch.target));
      if (target === undefined || target === null) {
        conflicts.push({ patch, localValue: undefined, reason: 'target-missing' });
        continue;
      }
      const current = getFieldValue(target, patch.field);
      if (deepEqual(current, patch.value)) {
        skipped += 1;
        continue;
      }
      if (!deepEqual(current, patch.oldValue)) {
        conflicts.push({ patch, localValue: current, reason: 'both-changed' });
        continue;
      }
      setFieldValue(target, patch.field, clone(patch.value));
      applied += 1;
      continue;
    }

    if (patch.kind === 'add') {
      const collection = findCollection(next, patch.collection);
      if (collection === null) {
        conflicts.push({ patch, localValue: undefined, reason: 'target-missing' });
        continue;
      }
      if (collection.some((item) => item.uid === patch.item.uid)) {
        skipped += 1;
        continue;
      }
      collection.push(clone(patch.item) as UidItem);
      applied += 1;
      continue;
    }

    if (patch.kind === 'remove') {
      const segments = splitPath(patch.target);
      const parent = getByPath(next, segments.slice(0, -1));
      if (!isUidCollection(parent)) {
        skipped += 1;
        continue;
      }
      const uid = segments[segments.length - 1];
      const index = parent.findIndex((item) => item.uid === uid);
      if (index < 0) {
        skipped += 1; // 本地早就删了，重复投递而已
        continue;
      }
      if (!deepEqual(parent[index], patch.oldValue)) {
        conflicts.push({ patch, localValue: parent[index], reason: 'both-changed' });
        continue;
      }
      parent.splice(index, 1);
      applied += 1;
      continue;
    }

    const reorder = patch as ReorderPatch;
    const collection = findCollection(next, reorder.collection);
    if (collection === null) {
      conflicts.push({ patch, localValue: undefined, reason: 'target-missing' });
      continue;
    }
    // 只关心 oldOrder 里提到过的那些条目（两边共有的）；本地自己新加的条目不参与排序
    const localOrder = collection
      .map((item) => item.uid)
      .filter((uid) => reorder.oldOrder.includes(uid));
    if (deepEqual(localOrder, reorder.order)) {
      skipped += 1;
      continue;
    }
    if (!deepEqual(localOrder, reorder.oldOrder)) {
      conflicts.push({ patch, localValue: localOrder, reason: 'both-changed' });
      continue;
    }
    const rank = new Map(reorder.order.map((uid, index) => [uid, index]));
    // 把这些条目按新顺序排好，再填回它们原本占的位置——不在名单里的原地不动
    const slots: number[] = [];
    collection.forEach((item, index) => {
      if (rank.has(item.uid)) slots.push(index);
    });
    const picked = slots.map((index) => collection[index]);
    picked.sort((a, b) => (rank.get(a.uid) ?? 0) - (rank.get(b.uid) ?? 0));
    slots.forEach((slot, index) => {
      collection[slot] = picked[index];
    });
    applied += 1;
  }

  return { doc: next as T, conflicts, applied, skipped };
}

/** 从冲突里取一条用来给人看的摘要 */
export function describePatch(patch: Patch): string {
  if (patch.kind === 'field') {
    const where = patch.target === '' ? '项目' : patch.target;
    return `${where} 的 ${patch.field}`;
  }
  if (patch.kind === 'add') {
    return `${patch.collection} 新增一条（${patch.item.uid}）`;
  }
  if (patch.kind === 'remove') {
    return `${patch.target} 被删除`;
  }
  return `${patch.collection} 的顺序调整`;
}

export type { AddPatch, FieldPatch, Patch, ReorderPatch };
