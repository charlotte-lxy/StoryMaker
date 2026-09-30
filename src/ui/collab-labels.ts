/**
 * 把协作的 patch 翻译成人话——纯展示用，不参与任何同步逻辑。
 *
 * 位置一律靠 uid 回到项目里找条目、取它的标题，而不是直接显示 chapters/c1 这种路径：
 * 策划看不懂路径，但认得「第一章 · 开场 · 台词（中文）」。
 */

import type { Patch } from '../core/collab/protocol';
import type { Project } from '../core/types';

const COLLECTION_NAMES: Record<string, string> = {
  characters: '角色',
  items: '物品',
  quests: '任务',
  images: '立绘',
  sounds: '音效',
  commands: '指令字典',
  chapters: '章节',
  groups: '段落',
  lines: '对话行',
  options: '选项',
  uiTexts: '界面文案',
  exportSettings: '导入设置',
  attributes: '属性',
  effects: '效果',
  skills: '技能',
  events: '事件',
  weapons: '武器',
  modifiers: '修改器',
  parameters: '参数',
};

/** 字段名 → 人话；没列到的就显示原名，不硬猜 */
const FIELD_NAMES: Record<string, string> = {
  name: '名称',
  id: 'ID',
  title: '标题',
  note: '备注',
  text: '文本',
  'text.zh': '文本（中文）',
  'text.en': '文本（英文）',
  'text.ja': '文本（日文）',
  command: '指令',
  characterUid: '角色',
  displayName: '显示名称',
  autoAdvance: '强制自动播放',
  nextId: '跳转目标',
  results: '结果',
  appearConditions: '出现条件',
  enableConditions: '可用条件',
  optionIds: '选项列表',
  fixedValues: '候选值',
  readableId: '对话ID',
  /* 战斗模块：引用的都是 uid，标签说清是「哪一栏的引用」 */
  attributeUid: '属性',
  attributes: '属性列表',
  lockSkillUids: '锁定GA列表',
  listenEventUids: '监听事件列表',
  skillUids: '技能列表',
  modifiers: '修改器列表',
};

/** 在项目里按 uid 找条目，顺手记下它在哪个集合字段下 */
export function findItem(
  node: unknown,
  uid: string,
): { item: Record<string, unknown>; collection: string } | null {
  if (node === null || typeof node !== 'object') return null;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object') continue;
      if ((entry as Record<string, unknown>).uid === uid) {
        return { item: entry as Record<string, unknown>, collection: key };
      }
    }
    for (const entry of value) {
      const found = findItem(entry, uid);
      if (found !== null) return found;
    }
  }
  return null;
}

/** 条目拿什么当"名字"给人看 */
export function labelOf(item: Record<string, unknown>): string {
  for (const key of ['title', 'name', 'readableId', 'id', 'key']) {
    const value = item[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return typeof item.uid === 'string' ? item.uid : '这一条';
}

export function lastUid(target: string): string {
  const parts = target.split('/');
  return parts[parts.length - 1] ?? '';
}

/** 一条 patch 说的是哪儿 */
export function describePatchLocation(project: Project, patch: Patch): string {
  if (patch.kind === 'add') {
    return `${COLLECTION_NAMES[patch.collection] ?? patch.collection}：新增`;
  }
  if (patch.kind === 'reorder') {
    return `${COLLECTION_NAMES[patch.collection] ?? patch.collection}：顺序`;
  }

  const found = findItem(project, lastUid(patch.target));
  const where = found === null ? patch.target : labelOf(found.item);

  if (patch.kind === 'remove') return `${where}：整条`;
  return `${where} · ${FIELD_NAMES[patch.field] ?? patch.field}`;
}

/** 这条 patch 算哪类改动 */
export function patchKindLabel(patch: Patch): string {
  if (patch.kind === 'add') return '新增';
  if (patch.kind === 'remove') return '删除';
  if (patch.kind === 'reorder') return '调整顺序';
  return '修改';
}

/** 值怎么显示给人看 */
export function renderValue(value: unknown): string {
  if (value === undefined) return '（没有）';
  if (value === null) return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value === '' ? '（空）' : value;
  if (Array.isArray(value)) {
    return value.length === 0 ? '（空列表）' : value.map((item) => String(item)).join('\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.uid === 'string') return labelOf(record);
    return JSON.stringify(value);
  }
  return String(value);
}

/** 这条 patch 带来的新内容，给人看的那一列 */
export function describePatchValue(project: Project, patch: Patch): string {
  if (patch.kind === 'field') {
    return `${renderValue(patch.oldValue)} → ${renderValue(patch.value)}`;
  }
  if (patch.kind === 'add') {
    return `「${labelOf(patch.item)}」`;
  }
  if (patch.kind === 'remove') {
    const found = findItem(project, lastUid(patch.target));
    return `「${found === null ? lastUid(patch.target) : labelOf(found.item)}」`;
  }
  return `${patch.order.length} 条的顺序变了`;
}
