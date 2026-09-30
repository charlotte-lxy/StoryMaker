/**
 * 可读 ID 的生成与重排。
 *
 * ID 形如 Dia_ch01_001-16，含义是：
 *   Dia  - 固定前缀
 *   ch01 - 章节
 *   001  - 段落（组）号
 *   16   - 段内句号
 * 段内句号在段落里连续编号，三种类型的行（对话 / 选项 / 指令）共用同一串号。
 * 选项在其所属「选项」行 ID 后加字母后缀，如 Dia_ch01_001-16A。
 *
 * 因为 ID 同时是 Unreal 行命名和本地化 key，插入一行会让后续 ID 位移，
 * 所以内部引用一律指向 uid；readableId 可在导出前用 renumberGroup 重新编号，
 * 并借返回的对照表同步本地化表。
 */

import type { Group, Line, StoryOption } from './types';

export const DIALOGUE_ID_PREFIX = 'Dia';
export const TEXT_ID_PREFIX = 'TXT_';

/** 内部稳定主键。crypto.randomUUID 在个别老环境里没有，退回随机串。 */
export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `uid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function makeLineId(chapterId: string, groupId: string, index: number): string {
  return `${DIALOGUE_ID_PREFIX}_${chapterId}_${groupId}-${index}`;
}

/** 0 → A, 1 → B, ... 25 → Z, 26 → AA */
export function optionSuffix(index: number): string {
  let n = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return suffix;
}

export function makeOptionId(hostLineId: string, index: number): string {
  return hostLineId + optionSuffix(index);
}

export function textIdOf(readableId: string): string {
  return TEXT_ID_PREFIX + readableId;
}

/**
 * 角色「默认名称」的本地化 key：TXT_ + 角色ID + _DefaultName。
 *
 * 角色名不进对话表的文本列，但同样要翻译，所以单独给它一条本地化条目。
 */
export function characterNameKeyOf(characterId: string): string {
  return `${textIdOf(characterId)}_DefaultName`;
}

/**
 * 角色「别名」的本地化 key：TXT_ + 角色ID + _OtherName- + 别名序号（从 1 开始）。
 *
 * 序号就是别名在角色表里的位置（别名1 → -1），所以删掉靠前的别名时，
 * 后面的序号会跟着往前挪——译文挂在别名自己身上，会一起挪过去。
 */
export function aliasNameKeyOf(characterId: string, index: number): string {
  return `${textIdOf(characterId)}_OtherName-${index + 1}`;
}

/**
 * 取可读 ID 里"段内序号"那一截，如 Dia_ch01_001-22 → 22。
 *
 * 界面上到处用完整 ID 太占地方，策划自己记的也是这个序号；
 * 取不到（比如选项 ID Dia_ch01_001-22A）时返回空串，由调用方决定退回什么。
 */
export function lineSequenceOf(readableId: string): string {
  const matched = /-(\d+)$/.exec(readableId);
  return matched === null ? '' : matched[1];
}

export interface IdChange {
  uid: string;
  oldId: string;
  newId: string;
}

/**
 * 「跳转到首句对话」的引用前缀。
 *
 * 选项的下一对话 ID 与「跳转到段落」行都可以不指向具体某一行，而是指向一个段落——
 * 意思是"跳到那个段落的第一句"。因为句号会随着插行 / 拖拽 / 删行重排，
 * 这种引用只在导出（以及画流程图）时才现取该段落当时的第一句。
 */
export const FIRST_LINE_PREFIX = '@first:';

export function firstLineRef(groupUid: string): string {
  return FIRST_LINE_PREFIX + groupUid;
}

/** 是「跳转到首句」的引用时返回它指向的段落 uid，否则返回 null */
export function groupUidOfFirstLine(value: string): string | null {
  return value.startsWith(FIRST_LINE_PREFIX) ? value.slice(FIRST_LINE_PREFIX.length) : null;
}

/** 段落的"第一句"是哪一行；空段落返回空串 */
export function firstLineIdOf(group: Group): string {
  return group.lines[0]?.readableId ?? '';
}

/**
 * 重排一个组内的可读 ID，返回新旧对照表。
 *
 * 只改 readableId，不动 uid，因此跳转目标与选项关联不会断。
 * 选项序号跟随其宿主行的序号，与其在 optionIds 中的次序一致。
 */
export function renumberGroup(group: Group, chapterId: string): IdChange[] {
  const changes: IdChange[] = [];

  const apply = (target: Line | StoryOption, newId: string): void => {
    if (target.readableId === newId) return;
    changes.push({ uid: target.uid, oldId: target.readableId, newId });
    target.readableId = newId;
  };

  group.lines.forEach((line, i) => {
    const lineId = makeLineId(chapterId, group.id, i + 1);
    apply(line, lineId);

    line.optionIds.forEach((optionUid, j) => {
      const option = group.options.find((o) => o.uid === optionUid);
      if (option !== undefined) apply(option, makeOptionId(lineId, j));
    });
  });

  return changes;
}
