/**
 * 指令的拼装与拆解。
 *
 * 通用格式：主指令[.分支]# 目标对象[.目标属性][运算符 目标结果]
 * 例如：
 *   特殊# SP_001
 *   剧情.图片# SCE_Home_001
 *   剧情.演出# CHA_西园寺雪.表情=悲伤
 *   背包# Item_Coin>=10
 */

import type { CommandDef, Project, TargetKind } from '../core/types';
import { collectRefUids } from './refs';
import type { LookupKind } from '../state/operations';

export interface CommandTargets {
  characters: { id: string; label: string }[];
  items: { id: string; label: string }[];
  quests: { id: string; label: string }[];
  images: { id: string; label: string }[];
  sounds: { id: string; label: string }[];
  lines: { id: string; label: string }[];
  /**
   * 项目里所有能当引用目标的 uid。
   *
   * 下拉里的 `id` 一律是 uid（内部引用只认 uid，改 ID、改名字都不会断），
   * 这个集合用来把指令文本里的 uid 目标认出来——uid 里带 `-`，
   * 光靠正则解析会被当成减号（见 parseCommand）。
   */
  uids: Set<string>;
}

/**
 * 「跳转到段落」块导出时用的指令头。
 *
 * 与字典里「剧情.播放对话」那条完全一致，只是这条不靠下拉填目标，
 * 而是由所选段落当前的第一句现拼出来（见 core/export.ts）。
 */
export const PLAY_DIALOGUE_HEAD = '剧情.播放对话';

/** 指令定义里某个目标来源对应哪张数据表 */
export function targetKindToLookup(kind: TargetKind): LookupKind | null {
  switch (kind) {
    case 'item':
      return 'items';
    case 'quest':
      return 'quests';
    case 'image':
      return 'images';
    case 'sound':
      return 'sounds';
    default:
      return null;
  }
}

/**
 * 把项目里的各张表整理成下拉需要的候选列表。
 *
 * 每条候选的 `id` 是**那一行的 uid**，`label` 才是给人看的可读 ID / 名字：
 * 下拉里存 uid，导出时（见 core/export.ts）再翻回 ID，所以改 ID 不会把引用写坏。
 */
export function collectCommandTargets(
  project: Project,
  lineLabels: { id: string; label: string }[],
): CommandTargets {
  const toOptions = (rows: { uid: string; id: string; name: string }[]) =>
    rows.map((row) => ({ id: row.uid, label: row.name === '' ? row.id : `${row.name}（${row.id}）` }));

  return {
    characters: project.characters.map((c) => ({
      id: c.uid,
      label: c.name === '' ? c.id : `${c.name}（${c.id}）`,
    })),
    items: toOptions(project.items),
    quests: toOptions(project.quests),
    images: toOptions(project.images),
    sounds: toOptions(project.sounds),
    lines: lineLabels,
    uids: collectRefUids(project),
  };
}

export function targetsFor(def: CommandDef, targets: CommandTargets): { id: string; label: string }[] {
  switch (def.target) {
    case 'character':
      return targets.characters;
    case 'item':
      return targets.items;
    case 'quest':
      return targets.quests;
    case 'image':
      return targets.images;
    case 'sound':
      return targets.sounds;
    case 'line':
      return targets.lines;
    default:
      return [];
  }
}

/**
 * 拼出一条指令文本。
 *
 * 注意 head 就是完整的指令头（如 `剧情.演出`、`任务.接取`），
 * branch 是给人看的分类名（如「设置表情」），**不参与拼装**。
 * 拼进去会得到 `剧情.演出.设置表情# …` 这种错误结果。
 */
export function buildCommand(def: CommandDef, target: string, value: string): string {
  let text = `${def.head}# ${target}`;
  if (def.attribute !== '') text += `.${def.attribute}`;
  if (def.operator !== '' && value !== '') text += `${def.operator}${value}`;
  return text;
}

/**
 * 指令定义在下拉里的显示名。
 *
 * 要短——它是 select 的选项文字，太长会把整个下拉撑宽。
 * 因此只用「分类名（没有分类就用指令头）」再加一个区分用的关键信息：
 * 有属性用属性（表情 / 进入 / 退出），否则用运算符（>= / +）。
 * 完整说明见 commandDefNote，放在 title 上。
 */
export function commandDefLabel(def: CommandDef): string {
  const name = def.branch !== '' ? def.branch : def.head;
  const detail = def.attribute !== '' ? def.attribute : def.operator;
  return detail === '' ? name : `${name} · ${detail}`;
}

/** 完整说明，鼠标悬停时显示 */
export function commandDefNote(def: CommandDef): string {
  const head = def.head;
  return def.note === '' ? head : `${head}　—　${def.note}`;
}

/**
 * 把一条指令文本对应回字典里的定义。
 *
 * 拼回可读的指令头：`剧情.演出` 在 parseCommand 里会被拆成 name=剧情、branch=演出，
 * 而字典里 head 存的是完整的 `剧情.演出`，所以这里要合起来比。
 *
 * 另外必须连运算符一起比：`背包` 在字典里有两条——条件用 >=，指令用 +，
 * 只看指令头区分不开。
 */
export function matchCommandDef(
  parsed: { name: string; branch: string; operator: string; attribute: string; target?: string },
  defs: CommandDef[],
  targets?: CommandTargets,
): CommandDef | undefined {
  const head = parsed.branch === '' ? parsed.name : `${parsed.name}.${parsed.branch}`;
  const matches = defs.filter((def) => {
    if (def.head !== head) return false;
    if (parsed.operator !== '' && def.operator !== parsed.operator) return false;
    // 同一指令头下还有「表情 / 动作 / 进入」这种按属性区分的条目
    if (parsed.attribute !== '' && def.attribute !== parsed.attribute) return false;
    return true;
  });

  if (matches.length <= 1 || targets === undefined) return matches[0];

  // 同一指令头也可能对应不同的目标来源（「剧情.图片」既能填图片 ID、也能填「移除」），
  // 这时看目标落在哪一条的候选项里；都不在就退回手工填写的那种。
  const target = parsed.target ?? '';
  const hit = matches.find((def) => targetsFor(def, targets).some((item) => item.id === target));
  if (hit !== undefined) return hit;
  return matches.find((def) => def.target === 'manual' || def.target === 'none') ?? matches[0];
}
