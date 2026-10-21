/**
 * 指令的拼装与拆解。
 *
 * 格式（E2）：
 *
 *   主指令|分支|参数名:值;参数名:值
 *
 * 例：
 *   剧情|演出|角色:CHA_西园寺雪;表情:悲伤
 *   背包||物品:Item_Coin;运算符:+;数量:100
 *   剧情|图片|                       （无参指令：移除图片）
 *   特殊||特殊指令:SP_001
 *
 * 三条规则：
 *   - 三段永远都在，空分支写成空段、无参数就空到底；
 *   - 参数名 / 值里不能出现分隔符 `|` `;` `:`，也不能出现 `,` `"` `(` `)`
 *     （选项的条件列还是 ("a","b") 数组，会把值切坏）；
 *   - 非必填参数没填时整项省略，不写 `名:`。
 *
 * 键值用 `:` 而不是 `=`，是因为「运算符」这个参数的值本身可能就是 `=`。
 */

import type { CommandDef, CommandParamDef, ParamSource, Project } from '../core/types';
import { collectRefUids } from './refs';
import type { LookupKind } from '../state/operations';

/** 参数名 / 值里不能出现的字符（分隔符，以及会把数组字面量切坏的字符） */
export const COMMAND_FORBIDDEN_CHARS = /[|;:,()"]/;

/** 判断一段文字里有没有不能用的字符；有就返回是哪一个，没有返回 null */
export function forbiddenCharOf(text: string): string | null {
  const matched = COMMAND_FORBIDDEN_CHARS.exec(text);
  return matched === null ? null : matched[0];
}

export interface CommandTargets {
  characters: { id: string; label: string }[];
  items: { id: string; label: string }[];
  quests: { id: string; label: string }[];
  images: { id: string; label: string }[];
  sounds: { id: string; label: string }[];
  lines: { id: string; label: string }[];
  /** 项目里所有能当引用目标的 uid，校验「引用还在不在」时用 */
  uids: Set<string>;
}

/** 「跳转到段落」块导出时用的主指令 / 分支，与默认字典里「剧情 / 播放对话」那条一致 */
export const PLAY_DIALOGUE_HEAD = '剧情';
export const PLAY_DIALOGUE_BRANCH = '播放对话';

/** 特殊演出效果块用的主指令 / 分支 / 参数名：`其他|特殊|特殊指令ID:SP_001` */
export const SPECIAL_COMMAND_HEAD = '其他';
export const SPECIAL_COMMAND_BRANCH = '特殊';
export const SPECIAL_COMMAND_PARAM = '特殊指令ID';

/** 延时块用的主指令 / 分支 / 参数名：`其他|延时|时长:0.5` */
export const DELAY_COMMAND_HEAD = '其他';
export const DELAY_COMMAND_BRANCH = '延时';
export const DELAY_COMMAND_PARAM = '时长';

/** 参数来源里，哪些是「指向某张表的引用」（存 uid，导出要翻成可读 ID） */
export function isReferenceSource(source: ParamSource): boolean {
  return (
    source === 'character' ||
    source === 'item' ||
    source === 'quest' ||
    source === 'image' ||
    source === 'sound' ||
    source === 'line'
  );
}

/** 参数来源对应哪张数据表（没有对应表的返回 null） */
export function sourceToLookup(source: ParamSource): LookupKind | null {
  switch (source) {
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

/** 某个参数来源的候选行 */
export function targetsOfSource(
  targets: CommandTargets,
  source: ParamSource,
): { id: string; label: string }[] {
  switch (source) {
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

/** 解析出来的指令：主指令 / 分支 / 参数（顺序就是文本里的顺序） */
export interface ParsedCommandText {
  head: string;
  branch: string;
  params: { name: string; value: string }[];
}

/** 拆一条指令文本；格式不对返回 null */
export function parseCommandText(text: string): ParsedCommandText | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const segments = trimmed.split('|');
  if (segments.length < 2 || segments.length > 3) return null;

  const head = segments[0].trim();
  if (head === '') return null;
  const branch = (segments[1] ?? '').trim();
  const rest = (segments[2] ?? '').trim();

  const params: { name: string; value: string }[] = [];
  if (rest !== '') {
    for (const part of rest.split(';')) {
      const at = part.indexOf(':');
      if (at < 0) return null;
      const name = part.slice(0, at).trim();
      if (name === '') return null;
      params.push({ name, value: part.slice(at + 1).trim() });
    }
  }

  return { head, branch, params };
}

/**
 * 按「主指令 + 分支」找字典里的那一条。
 *
 * 只在同一个 category 里找：条件和指令的文本格式一样，混在一起会选错。
 */
export function findCommandDef(
  defs: readonly CommandDef[],
  category: '条件' | '指令',
  head: string,
  branch: string,
): CommandDef | undefined {
  const wantedHead = head.trim();
  const wantedBranch = branch.trim();
  return defs.find(
    (def) =>
      def.category === category &&
      def.head.trim() === wantedHead &&
      def.branch.trim() === wantedBranch,
  );
}

/** 一条指令文本对应的字典条目；匹配不上返回 undefined */
export function matchCommandText(
  text: string,
  defs: readonly CommandDef[],
  category: '条件' | '指令',
): CommandDef | undefined {
  const parsed = parseCommandText(text);
  if (parsed === null) return undefined;
  return findCommandDef(defs, category, parsed.head, parsed.branch);
}

/**
 * 把「主指令 / 分支 / 参数」拼成一条指令文本。
 *
 * 参数名为空或值为空的那一项不写（非必填参数没填时整项省略）。
 */
export function formatCommandText(
  head: string,
  branch: string,
  params: readonly { name: string; value: string }[],
): string {
  const rest = params
    .filter((param) => param.name.trim() !== '' && param.value.trim() !== '')
    .map((param) => `${param.name.trim()}:${param.value.trim()}`)
    .join(';');
  return `${head.trim()}|${branch.trim()}|${rest}`;
}

/**
 * 按字典定义拼一条指令文本。
 *
 * values 以参数名为键；值是空串的参数整项省略（必填没填时由校验条报出来）。
 */
export function buildCommandText(def: CommandDef, values: Record<string, string>): string {
  return formatCommandText(
    def.head,
    def.branch,
    def.params.map((param) => ({ name: param.name, value: values[param.name] ?? '' })),
  );
}

/** 把解析出来的参数摊成「参数名 → 值」，方便回填控件 */
export function paramValuesOf(parsed: ParsedCommandText | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of parsed?.params ?? []) values[param.name] = param.value;
  return values;
}

/** 「跳转到段落」行拼出来的指令：剧情|播放对话|对话:<第一句对话ID> */
export function buildPlayDialogueCommand(lineId: string, paramName = '对话'): string {
  const value = lineId.trim();
  return value === '' ? '' : `${PLAY_DIALOGUE_HEAD}|${PLAY_DIALOGUE_BRANCH}|${paramName}:${value}`;
}

/** 「特殊演出效果」块拼出来的指令：其他|特殊|特殊指令ID:<名称> */
export function buildSpecialCommand(name: string, paramName = SPECIAL_COMMAND_PARAM): string {
  const value = name.trim();
  return formatCommandText(SPECIAL_COMMAND_HEAD, SPECIAL_COMMAND_BRANCH, [
    { name: paramName, value },
  ]);
}

/** 一条指令是不是「特殊演出效果」（主指令=其他、分支=特殊） */
export function isSpecialCommandText(command: string): boolean {
  const parsed = parseCommandText(command);
  return (
    parsed !== null &&
    parsed.head === SPECIAL_COMMAND_HEAD &&
    parsed.branch === SPECIAL_COMMAND_BRANCH
  );
}

/**
 * 从「特殊演出效果」行的指令文本里取回指令名称。
 *
 * 不是这个格式时原样返回，好让人看见并改掉。
 */
export function specialEffectNameOf(command: string, paramName = SPECIAL_COMMAND_PARAM): string {
  const parsed = parseCommandText(command);
  if (parsed === null || !isSpecialCommandText(command)) return command;
  const named = parsed.params.find((param) => param.name === paramName);
  return named?.value ?? '';
}

/** 「延时」块拼出来的指令：其他|延时|时长:<秒数> */
export function buildDelayCommand(seconds: string, paramName = DELAY_COMMAND_PARAM): string {
  return formatCommandText(DELAY_COMMAND_HEAD, DELAY_COMMAND_BRANCH, [
    { name: paramName, value: seconds.trim() },
  ]);
}

/** 一条指令是不是「延时」（主指令=其他、分支=延时） */
export function isDelayCommandText(command: string): boolean {
  const parsed = parseCommandText(command);
  return (
    parsed !== null &&
    parsed.head === DELAY_COMMAND_HEAD &&
    parsed.branch === DELAY_COMMAND_BRANCH
  );
}

/** 从「延时」行的指令文本里取回秒数；不是这个格式时返回空串 */
export function delaySecondsOf(command: string, paramName = DELAY_COMMAND_PARAM): string {
  const parsed = parseCommandText(command);
  if (parsed === null || !isDelayCommandText(command)) return '';
  const named = parsed.params.find((param) => param.name === paramName);
  return named?.value ?? '';
}

/** 字典条目在下拉里的显示名：主指令，有分支时带上分支 */
export function commandDefLabel(def: CommandDef): string {
  const head = def.head.trim();
  const branch = def.branch.trim();
  return branch === '' ? head : `${head} · ${branch}`;
}

/** 完整说明，鼠标悬停时显示 */
export function commandDefNote(def: CommandDef): string {
  const name = commandDefLabel(def);
  return def.note === '' ? name : `${name}　—　${def.note}`;
}

/** 参数控件旁边的标题：参数名 + 说明 */
export function paramTitle(param: CommandParamDef): string {
  const note = param.note.trim();
  return note === '' ? param.name : `${param.name}　—　${note}`;
}
