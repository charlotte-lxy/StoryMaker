/**
 * 内部引用（uid）与导出用的可读 ID 之间的翻译。
 *
 * 规矩：**软件内部的引用一律指向 uid，只有导出那一刻才翻成 Unreal 要的 ID。**
 * 因此把「角色 ID」「物品 ID」改掉，甚至改属性名、技能名，都不会把引用写坏；
 * 反过来，老项目里按 ID / 名字存的那些引用，读进来时也要按表换成 uid（见 migrate.ts）。
 *
 * 涉及的表：对话行、选项、角色、物品、任务、立绘、音效。
 * 战斗模块的属性 / 技能 / 事件不是「导出成 ID」，而是「导出成名字合成的 Tag」，
 * 所以它们只用到 uid → 行 的查找，不在这张 ID 表里。
 */

import type { BattleData, GasAttribute, GasEvent, GasSkill, Project, TargetKind } from './types';

/** uid → 导出用的可读 ID */
export type UidToId = Map<string, string>;
/** 导出用的可读 ID → uid（给老文件和手写指令用） */
export type IdToUid = Map<string, string>;

export interface RefMaps {
  byUid: UidToId;
  byId: IdToUid;
}

type LookupKind = 'items' | 'quests' | 'images' | 'sounds';

/** 指令的目标来源对应哪张表；没有对应表（手工填写 / 无目标）时返回 null */
export function lookupKindOfTarget(kind: TargetKind): LookupKind | 'characters' | 'lines' | null {
  switch (kind) {
    case 'character':
      return 'characters';
    case 'item':
      return 'items';
    case 'quest':
      return 'quests';
    case 'image':
      return 'images';
    case 'sound':
      return 'sounds';
    case 'line':
      return 'lines';
    default:
      return null;
  }
}

/**
 * 收集各表的 uid 与可读 ID 的双向对照。
 *
 * 同一张表里 ID 重名时以**先出现的那条**为准（界面上的下拉也是这个顺序）；
 * 重名本身由校验层去报。
 */
export function collectRefMaps(project: Project): RefMaps {
  const byUid: UidToId = new Map();
  const byId: IdToUid = new Map();

  const add = (uid: string, id: string): void => {
    if (uid === '' || id === '') return;
    byUid.set(uid, id);
    if (!byId.has(id)) byId.set(id, uid);
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) add(line.uid, line.readableId);
      for (const option of group.options) add(option.uid, option.readableId);
    }
  }
  for (const character of project.characters) add(character.uid, character.id);
  for (const kind of ['items', 'quests', 'images', 'sounds'] as const) {
    for (const row of project[kind]) add(row.uid, row.id);
  }

  return { byUid, byId };
}

/**
 * 这个值看起来是不是一个 uid。
 *
 * 提示文案里用它决定怎么写给人看：uid 是一长串乱码，读不出是哪一条，
 * 与其把乱码塞进校验条，不如说「已经不在了」；老数据里存的 ID / 名字则照原样显示。
 */
export function looksLikeUid(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(trimmed) || trimmed.startsWith('uid-');
}

/** 项目里所有能当引用目标的 uid（指令文本里的目标靠它认出来，见 parseCommand） */export function collectRefUids(project: Project): Set<string> {
  const uids = new Set<string>();
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) uids.add(line.uid);
      for (const option of group.options) uids.add(option.uid);
    }
  }
  for (const character of project.characters) uids.add(character.uid);
  for (const kind of ['items', 'quests', 'images', 'sounds'] as const) {
    for (const row of project[kind]) uids.add(row.uid);
  }
  return uids;
}

/**
 * 把指令 / 条件文本里 `#` 后面那一截的目标换成对照表里的另一个写法。
 *
 * 界面上选目标时写进文本的是 **uid**，导出给 Unreal 的必须是可读 ID，
 * 反过来读老文件时要把 ID 换成 uid，两个方向共用这一个函数。
 *
 * 不能靠解析指令来取目标：uid 里带 `-`，解析器会把第一个 `-` 当成运算符
 * （`8f3c1b2a-1234-…` 会被拆成 目标=8f3c1b2a + 运算符=-）。所以只认 `#`
 * 后面那一截，并从长到短找一个"正好是表中的键"的前缀——目标后面可能紧跟
 * `.属性` 或 `=结果`，这样两步都不会切错。
 */
export function translateTarget(text: string, map: UidToId | IdToUid): string {
  const hash = text.indexOf('#');
  if (hash < 0) return text;

  let start = hash + 1;
  while (start < text.length && /\s/.test(text[start])) start += 1;

  for (let end = text.length; end > start; end -= 1) {
    const replacement = map.get(text.slice(start, end));
    if (replacement === undefined) continue;
    return text.slice(0, start) + replacement + text.slice(end);
  }
  return text;
}

/**
 * 从指令 / 条件文本里取出 `#` 后面开头的那个 uid；没有就返回空串。
 *
 * 给校验层查「引用还写着，但那一行已经被删掉了」用：只认长得就是 uid 的目标，
 * 老数据里按 ID / 名字写的目标不在此列（那种情况跟改之前一样不报）。
 */
export function leadingUid(text: string): string {
  const hash = text.indexOf('#');
  if (hash < 0) return '';
  const rest = text.slice(hash + 1).replace(/^\s+/, '');
  const matched =
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|uid-[A-Za-z0-9]+-[A-Za-z0-9]+)/.exec(
      rest,
    );
  return matched?.[1] ?? '';
}

/* ---------- 按 uid 找行 ---------- */

export function characterOfUid(project: Project, uid: string) {
  return project.characters.find((row) => row.uid === uid);
}

export function lookupOfUid(project: Project, kind: LookupKind, uid: string) {
  return project[kind].find((row) => row.uid === uid);
}

/** 物品 / 任务 / 立绘 / 音效按 uid 取导出 ID；找不到时返回空串 */
export function idOfLookup(project: Project, kind: LookupKind, uid: string): string {
  return lookupOfUid(project, kind, uid)?.id ?? '';
}

export function attributeOfUid(battle: BattleData, uid: string): GasAttribute | undefined {
  return battle.attributes.find((row) => row.uid === uid);
}

export function skillOfUid(battle: BattleData, uid: string): GasSkill | undefined {
  return battle.skills.find((row) => row.uid === uid);
}

export function eventOfUid(battle: BattleData, uid: string): GasEvent | undefined {
  return battle.events.find((row) => row.uid === uid);
}

/**
 * 属性引用怎么解析：先当 uid 找，找不到就把原值当**属性名**再找一次。
 *
 * 后一半是给老项目和手写数据留的：那种数据里存的是名字，
 * 按名字也认不出来时（引用的行被删了）返回 undefined，交给校验层报悬空。
 */
export function resolveAttribute(battle: BattleData, ref: string): GasAttribute | undefined {
  const value = ref.trim();
  if (value === '') return undefined;
  return attributeOfUid(battle, value) ?? battle.attributes.find((row) => row.name.trim() === value);
}

export function resolveSkill(battle: BattleData, ref: string): GasSkill | undefined {
  const value = ref.trim();
  if (value === '') return undefined;
  return skillOfUid(battle, value) ?? battle.skills.find((row) => row.name.trim() === value);
}

export function resolveEvent(battle: BattleData, ref: string): GasEvent | undefined {
  const value = ref.trim();
  if (value === '') return undefined;
  return eventOfUid(battle, value) ?? battle.events.find((row) => row.name.trim() === value);
}

/* ---------- 导出时把引用翻回可读 ID / 名字 ---------- */

/**
 * 下面这几个都是「解析得到就用那一行的，解析不到就把原值原样写出去」。
 *
 * 解析不到还写原值，是为了照顾两类数据：老项目里引用了表里没有的条目
 * （例如角色还没建），以及策划按 ID / 名字手敲的指令——它们的导出结果
 * 跟改之前一模一样，悬空这件事交给校验条去提醒。
 */

export function characterIdOf(project: Project, ref: string): string {
  const value = ref.trim();
  if (value === '') return '';
  return characterOfUid(project, value)?.id.trim() ?? value;
}

export function attributeNameOf(battle: BattleData, ref: string): string {
  const value = ref.trim();
  if (value === '') return '';
  return resolveAttribute(battle, value)?.name.trim() ?? value;
}

export function skillNameOf(battle: BattleData, ref: string): string {
  const value = ref.trim();
  if (value === '') return '';
  return resolveSkill(battle, value)?.name.trim() ?? value;
}

export function eventNameOf(battle: BattleData, ref: string): string {
  const value = ref.trim();
  if (value === '') return '';
  return resolveEvent(battle, value)?.name.trim() ?? value;
}
