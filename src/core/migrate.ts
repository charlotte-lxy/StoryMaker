/**
 * 项目 JSON 的读取与老结构迁移。
 *
 * 早期版本的模型里，「指令」是挂在对话行上的一个字符串数组，「选项」挂在对话行的
 * optionIds 上，另外还有一种「其他」类型的演出行。现在三种东西各自占一行：
 *
 *   老结构                                新结构
 *   line.commands = [c1, c2]      →       紧挨着的两行「指令」
 *   line.text / 角色              →       一行「对话」（「其他」行没有文本时不再保留）
 *   line.optionIds = [o1, o2]     →       紧随其后的一行「选项」
 *
 * 迁移只改结构、不动内容：文本、角色、指令原文、选项本身全部原样保留。
 * 因为插入了新行，段内可读 ID 必须重排，重排的对照表会返回给界面，
 * 方便策划交给本地化同事同步 TXT_ 开头的 key。
 */

import { DEFAULT_EFFECT_CLASS_PREFIX, DEFAULT_SKILL_CLASS_PREFIX } from './battle';
import {
  buildCommandText,
  findCommandDef,
  isReferenceSource,
  parseCommandText,
} from './command-build';
import { defaultCommandDefs } from './default-commands';
import { firstLineRef, groupUidOfFirstLine, makeLineId, newUid, renumberGroup, type IdChange } from './ids';
import { collectRefMaps, collectRefUids } from './refs';
import { DEFAULT_SPECIAL_COMMAND_CLASS_PREFIX } from './special-commands';
import {
  DEFAULT_PLAY_POSITION,
  type BattleData,
  type Chapter,
  type Character,
  type CommandDef,
  type CommandParamDef,
  type GasModifier,
  type GasPair,
  type Group,
  type Line,
  type LineKind,
  type LocalizedText,
  type ParamSource,
  type Project,
  type StoryOption,
} from './types';

export interface NormalizeResult {
  project: Project;
  /** 迁移造成的可读 ID 变化；空数组表示本来就是新结构 */
  changes: IdChange[];
}

/** 读取时用的宽松行：字段可能是任何类型，逐个收窄 */
interface RawLine extends Partial<Line> {
  commands?: unknown;
  /** 老字段：角色 ID。现在存的是角色 uid，读的时候要按表换过来 */
  characterId?: unknown;
  /** 老字段：显示名（自由文本）。现在存的是别名 uid，读的时候要收进角色表 */
  displayName?: unknown;
}

/**
 * 老结构的一行（指令挂在对话行上，「其他」还是合法的类型）。
 * 只给读取旧 CSV / xlsx 的脚本用，应用内部一律是新结构。
 */
export interface LegacyLine {
  uid: string;
  readableId: string;
  kind: '对话' | '其他';
  characterId: string;
  displayName: string;
  text: LocalizedText;
  autoAdvance: boolean;
  commands: string[];
  optionIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asUid(value: unknown): string {
  const uid = asString(value);
  return uid === '' ? newUid() : uid;
}

function asLocalized(value: unknown): LocalizedText {
  const raw = isRecord(value) ? value : {};
  return { zh: asString(raw.zh), en: asString(raw.en), ja: asString(raw.ja) };
}

function makeLine(kind: LineKind, over: Partial<Line> = {}): Line {
  return {
    uid: newUid(),
    readableId: '',
    kind,
    characterUid: '',
    // 老结构里的「显示名」文本先原样放这儿，等角色表补齐后由 migrateDisplayNames 收进别名
    displayAliasUid: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    command: '',
    // 老项目里没有这个字段：null = 普通行（不是「特殊演出效果」行）
    specialContent: null,
    // 老项目里没有这个字段：null = 普通行（不是「跳转到段落」行）
    jumpGroupUid: null,
    jumpConditions: [],
    optionIds: [],
    note: '',
    ...over,
  };
}

/**
 * 读取一个项目 JSON。
 *
 * 缺字段、老结构、个别字段类型不对都不应该让界面白屏，所以这里一律宽容处理；
 * 返回值里的 changes 是迁移造成的 ID 变化，没有迁移时为空数组。
 */
export function normalizeProject(input: unknown): NormalizeResult | null {
  if (!isRecord(input)) return null;
  if (input.version !== 1 || !Array.isArray(input.chapters)) return null;

  const project = input as unknown as Project;

  if (!Array.isArray(project.characters)) project.characters = [];
  for (const key of ['items', 'quests', 'images', 'sounds', 'commands'] as const) {
    if (!Array.isArray(project[key])) project[key] = [];
  }
  if (!Array.isArray(project.variables)) project.variables = [];

  // UI 本地化：老项目里没有这栏，给个空表；已有的行也补齐字段，
  // 免得手改过的 JSON 让界面读到 undefined 的文本对象。
  const rawUiTexts: unknown = project.uiTexts;
  project.uiTexts = (Array.isArray(rawUiTexts) ? rawUiTexts : [])
    .filter(isRecord)
    .map((row) => ({
      uid: asUid(row.uid),
      key: asString(row.key),
      text: asLocalized(row.text),
    }));

  // 角色名 / 显示名的译文是老版本单独存的（nameTexts，按 uid 挂）；
  // 现在译文就挂在角色和别名自己身上，这里先把老表读出来备用，最后不再保留
  const rawNameTexts: unknown = (project as unknown as Record<string, unknown>).nameTexts;
  const legacyNameTexts = new Map<string, { en: string; ja: string }>();
  for (const row of (Array.isArray(rawNameTexts) ? rawNameTexts : []).filter(isRecord)) {
    const uid = asString(row.uid);
    if (uid !== '') legacyNameTexts.set(uid, { en: asString(row.en), ja: asString(row.ja) });
  }
  delete (project as unknown as Record<string, unknown>).nameTexts;

  // 战斗模块也是后加的：缺哪张表补哪张，路径前缀缺了就用默认值
  project.battle = normalizeBattle(project.battle);

  // 「特殊指令」子表的 Command类 前缀同样是后加的，缺了就用默认值
  const rawSpecialPrefix: unknown = project.specialCommandClassPrefix;
  project.specialCommandClassPrefix =
    typeof rawSpecialPrefix === 'string' && rawSpecialPrefix !== ''
      ? rawSpecialPrefix
      : DEFAULT_SPECIAL_COMMAND_CLASS_PREFIX;

  // 导入设置同样是后加的：老项目里没有这栏
  const rawExportSettings: unknown = project.exportSettings;
  project.exportSettings = (Array.isArray(rawExportSettings) ? rawExportSettings : [])
    .filter(isRecord)
    .map((row) => ({
      uid: asUid(row.uid),
      tableName: asString(row.tableName),
      folder: asString(row.folder),
      subTable: asString(row.subTable),
    }));

  const rawCharacters = project.characters as unknown as Record<string, unknown>[];
  project.characters = rawCharacters.filter(isRecord).map((row) => {
    const uid = asUid(row.uid);
    const legacy = legacyNameTexts.get(uid);
    return {
      uid,
      id: asString(row.id),
      name: asString(row.name),
      // 默认名称的译文：老版本存在 nameTexts 里，现在挂在角色上
      nameEn: asString(row.nameEn) || (legacy?.en ?? ''),
      nameJa: asString(row.nameJa) || (legacy?.ja ?? ''),
      // 播放位置是后加的字段：老项目里没有，给默认值（空串也给默认）
      playPosition:
        asString(row.playPosition) === ''
          ? DEFAULT_PLAY_POSITION
          : (asString(row.playPosition) as Character['playPosition']),
      aliases: (Array.isArray(row.aliases) ? row.aliases : [])
        .filter(isRecord)
        .map((item) => ({
          uid: asUid(item.uid),
          text: asString(item.text),
          en: asString(item.en),
          ja: asString(item.ja),
        })),
      expressions: Array.isArray(row.expressions)
        ? row.expressions.filter((item): item is string => typeof item === 'string')
        : [],
      actions: Array.isArray(row.actions)
        ? row.actions.filter((item): item is string => typeof item === 'string')
        : [],
    };
  });

  const changes: IdChange[] = [];
  for (const chapter of project.chapters as (Chapter & { groups?: Group[] })[]) {
    if (!Array.isArray(chapter.groups)) chapter.groups = [];
    for (const group of chapter.groups) {
      if (!Array.isArray(group.lines)) group.lines = [];
      if (!Array.isArray(group.options)) group.options = [];
      // 段落注释是后加的字段，老项目里没有
      group.note = asString(group.note);
      migrateGroup(group, chapter.id, changes);
    }
  }

  // 指令字典与指令文本统一换成「主指令|分支|参数」：先换字典（老默认字典合并成新条目），
  // 再把选项里的老「结果」搬成指令行，最后改写所有指令 / 条件文本
  normalizeCommandDict(project);
  migrateOptionResults(project);
  migrateCommandTexts(project);

  // 各张表都补齐之后再统一换引用（角色 uid 也在这时候定下来），
  // 然后才能把对话行的显示名收进角色表的别名里
  migrateRefs(project);
  migrateDisplayNames(project, legacyNameTexts);

  return { project, changes };
}

/**
 * 把对话行里原来的「显示名」收进角色表的别名里。
 *
 *   - 与角色的默认名称相同  → 这一行改成「（默认名称）」
 *   - 别的写法            → 给该角色建一个别名（同一个写法只建一个，多行共用），
 *                          行里改成选这个别名
 *   - 没选角色 / 角色已删   → 收不进去，原样留着，交给校验条报出来
 *
 * 老的 TXT_<对话ID>_DisplayName 译文一并搬到新别名上（同一个别名多行都有译文时取第一条非空的），
 * 免得本地化同事白填一遍。
 */
function migrateDisplayNames(
  project: Project,
  legacyNameTexts: Map<string, { en: string; ja: string }>,
): void {
  const byUid = new Map(project.characters.map((row) => [row.uid, row]));
  /** 老数据里按角色 ID 写的也算，跟校验层一个口径 */
  const findCharacter = (ref: string): Character | undefined =>
    byUid.get(ref) ?? project.characters.find((row) => row.id.trim() === ref.trim());

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        // 已经迁过的（uid 指得到别名）不再动
        const character = findCharacter(line.characterUid);
        const current = line.displayAliasUid.trim();
        if (
          character !== undefined &&
          (current === '' || character.aliases.some((alias) => alias.uid === current))
        ) {
          continue;
        }

        // 这一格现在是别名 uid；老结构里放的是显示名文本（migrateGroup 原样搬过来的）
        const text = line.displayAliasUid.trim();
        const translation = legacyNameTexts.get(line.uid);

        if (character === undefined) {
          // 没角色可归：文本原样留着（界面上显示成「不在别名里」），校验条会提醒
          line.displayAliasUid = text;
          continue;
        }
        if (text === '' || text === character.name.trim()) {
          line.displayAliasUid = '';
          continue;
        }

        let alias = character.aliases.find((item) => item.text.trim() === text);
        if (alias === undefined) {
          alias = { uid: newUid(), text, en: '', ja: '' };
          character.aliases.push(alias);
        }
        // 译文只填一次：同一个别名被多行用到时，取第一条非空的
        if (alias.en === '' && alias.ja === '') {
          alias.en = translation?.en ?? '';
          alias.ja = translation?.ja ?? '';
        }
        line.displayAliasUid = alias.uid;
      }
    }
  }
}

/** 战斗模块：缺的表补空、缺的字段给默认值，手改过的 JSON 也不至于让界面拿到 undefined */
function normalizeBattle(input: unknown): BattleData {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};

  const rows = (key: string): Record<string, unknown>[] =>
    Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter(isRecord) : [];

  const modifiers = (value: unknown): GasModifier[] =>
    (Array.isArray(value) ? value : []).filter(isRecord).map((row) => ({
      uid: asUid(row.uid),
      duration: asString(row.duration) || '基础',
      // 老字段 attribute 存的是属性名，后面统一按表换过来
      attributeUid: asString(row.attributeUid) || asString(row.attribute),
      operator: asString(row.operator) || '+',
      value: asString(row.value),
    }));

  const pairs = (value: unknown): GasPair[] =>
    (Array.isArray(value) ? value : []).filter(isRecord).map((row) => ({
      uid: asUid(row.uid),
      key: asString(row.key),
      value: asString(row.value),
    }));

  const names = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string');

  /** 引用列表：优先读新字段（uid），没有就退回老字段（名字 / ID），后面统一换 */
  const refs = (row: Record<string, unknown>, key: string, legacyKey: string): string[] => {
    const next = names(row[key]);
    return next.length > 0 ? next : names(row[legacyKey]);
  };

  const text = (row: Record<string, unknown>, key: string): string => asString(row[key]);
  const flag = (row: Record<string, unknown>, key: string): boolean => row[key] === true;

  return {
    skillClassPrefix: asString(raw.skillClassPrefix) || DEFAULT_SKILL_CLASS_PREFIX,
    effectClassPrefix: asString(raw.effectClassPrefix) || DEFAULT_EFFECT_CLASS_PREFIX,
    attributes: rows('attributes').map((row) => ({
      uid: asUid(row.uid),
      name: text(row, 'name'),
      note: text(row, 'note'),
      tagNote: text(row, 'tagNote'),
    })),
    effects: rows('effects').map((row) => ({
      uid: asUid(row.uid),
      name: text(row, 'name'),
      note: text(row, 'note'),
      className: text(row, 'className'),
      duration: text(row, 'duration'),
      period: text(row, 'period'),
      periodImmediate: flag(row, 'periodImmediate'),
      reduceStacks: text(row, 'reduceStacks'),
      maxStacks: text(row, 'maxStacks'),
      refreshDuration: flag(row, 'refreshDuration'),
      refreshPeriod: flag(row, 'refreshPeriod'),
      modifiers: modifiers(row.modifiers),
      tagNote: text(row, 'tagNote'),
    })),
    skills: rows('skills').map((row) => ({
      uid: asUid(row.uid),
      name: text(row, 'name'),
      className: text(row, 'className'),
      lockSkillUids: refs(row, 'lockSkillUids', 'lockSkills'),
      listenEventUids: refs(row, 'listenEventUids', 'listenEvents'),
      parameters: pairs(row.parameters),
      tagNote: text(row, 'tagNote'),
    })),
    events: rows('events').map((row) => ({
      uid: asUid(row.uid),
      name: text(row, 'name'),
      note: text(row, 'note'),
      tagNote: text(row, 'tagNote'),
    })),
    characters: rows('characters').map((row) => ({
      uid: asUid(row.uid),
      id: text(row, 'id'),
      name: text(row, 'name'),
      attributes: pairs(row.attributes),
      skillUids: refs(row, 'skillUids', 'skills'),
    })),
    weapons: rows('weapons').map((row) => ({
      uid: asUid(row.uid),
      id: text(row, 'id'),
      name: text(row, 'name'),
      description: text(row, 'description'),
      magazine: text(row, 'magazine'),
      attackSpeed: text(row, 'attackSpeed'),
      modifiers: modifiers(row.modifiers),
      skillUids: refs(row, 'skillUids', 'skills'),
    })),
  };
}

/**
 * 把按「ID / 名字」存的引用换成 uid。
 *
 * 新写的文件里引用本来就是 uid，这里对它们是空操作；老文件、手改过的 JSON、
 * 以及策划手敲进参数里的 `背包||物品:Item_Coin;…` 都会在这一步归一到 uid。
 * 表里找不到对应行时**原样保留**（可能只是那一行还没建），交给校验条去报悬空。
 */
function migrateRefs(project: Project): void {
  const maps = collectRefMaps(project);
  const battle = project.battle;

  /** 已经是已知 uid 就留着，否则按可读 ID 换一次 */
  const toUid = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed === '' || maps.byUid.has(trimmed)) return value;
    return maps.byId.get(trimmed) ?? value;
  };

  /** 战斗表里的引用：已经是那一行的 uid 就留着，否则按名字找那一行 */
  const toRowUid = (value: string, uids: Set<string>, byName: Map<string, string>): string => {
    const trimmed = value.trim();
    if (trimmed === '' || uids.has(trimmed)) return value;
    return byName.get(trimmed) ?? value;
  };

  const nameMap = (rows: { uid: string; name: string }[]): Map<string, string> => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (name !== '' && !map.has(name)) map.set(name, row.uid);
    }
    return map;
  };

  const attributeByName = nameMap(battle.attributes);
  const skillByName = nameMap(battle.skills);
  const eventByName = nameMap(battle.events);
  const attributeUids = new Set(battle.attributes.map((row) => row.uid));
  const skillUids = new Set(battle.skills.map((row) => row.uid));
  const eventUids = new Set(battle.events.map((row) => row.uid));

  /** 指令文本里「指向某张表的参数」按参数定义把可读 ID 换成 uid，别的参数原样保留 */
  const translateCommand = (text: string, category: '条件' | '指令'): string => {
    const parsed = parseCommandText(text);
    if (parsed === null) return text;
    const def = findCommandDef(project.commands, category, parsed.head, parsed.branch);
    if (def === undefined) return text;
    const values: Record<string, string> = {};
    for (const param of parsed.params) {
      const paramDef = def.params.find((item) => item.name.trim() === param.name);
      const reference = paramDef !== undefined && isReferenceSource(paramDef.source);
      values[param.name] = reference ? toUid(param.value) : param.value;
    }
    return buildCommandText(def, values);
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        line.characterUid = toUid(line.characterUid);
        // 「跳转到段落」行的指令是按段落现拼的，数据里那格是空的，不用翻译
        if (line.jumpGroupUid === null) line.command = translateCommand(line.command, '指令');
        line.jumpConditions = line.jumpConditions.map((text) => translateCommand(text, '条件'));
      }
      for (const option of group.options) {
        option.appearConditions = option.appearConditions.map((text) =>
          translateCommand(text, '条件'),
        );
        option.enableConditions = option.enableConditions.map((text) =>
          translateCommand(text, '条件'),
        );
      }
    }
  }

  for (const effect of battle.effects) {
    for (const modifier of effect.modifiers) {
      modifier.attributeUid = toRowUid(modifier.attributeUid, attributeUids, attributeByName);
    }
  }
  for (const skill of battle.skills) {
    skill.lockSkillUids = skill.lockSkillUids.map((ref) => toRowUid(ref, skillUids, skillByName));
    skill.listenEventUids = skill.listenEventUids.map((ref) =>
      toRowUid(ref, eventUids, eventByName),
    );
  }
  for (const character of battle.characters) {
    for (const pair of character.attributes) {
      pair.key = toRowUid(pair.key, attributeUids, attributeByName);
    }
    character.skillUids = character.skillUids.map((ref) => toRowUid(ref, skillUids, skillByName));
  }
  for (const weapon of battle.weapons) {
    for (const modifier of weapon.modifiers) {
      modifier.attributeUid = toRowUid(modifier.attributeUid, attributeUids, attributeByName);
    }
    weapon.skillUids = weapon.skillUids.map((ref) => toRowUid(ref, skillUids, skillByName));
  }
}

function migrateGroup(group: Group, chapterId: string, changes: IdChange[]): void {  let migrated = false;
  const lines: Line[] = [];

  for (const raw of group.lines as RawLine[]) {
    const legacyCommands = Array.isArray(raw.commands) ? raw.commands : null;
    const optionIds = Array.isArray(raw.optionIds)
      ? raw.optionIds.filter((uid): uid is string => typeof uid === 'string' && uid !== '')
      : [];
    const rawKind: string = typeof raw.kind === 'string' ? raw.kind : '';
    const isNewKind = rawKind === '对话' || rawKind === '选项' || rawKind === '指令';
    // 老结构：带 commands 字段、非「选项」行上还挂着 optionIds，或类型是已取消的「其他」
    const isLegacy =
      legacyCommands !== null || !isNewKind || (rawKind !== '选项' && optionIds.length > 0);

    // 已经是新结构：补齐字段就够，不动 ID
    if (!isLegacy) {
      lines.push(
        makeLine(rawKind as LineKind, {
          uid: asUid(raw.uid),
          readableId: asString(raw.readableId),
          // 新结构存的是角色 uid；老结构存的是角色 ID，后面统一按表换过来
          characterUid: asString(raw.characterUid) || asString(raw.characterId),
          // 新结构存的是别名 uid；老结构里是显示名文本，先原样放这儿，
          // 后面由 migrateDisplayNames 收进角色表的别名里
          displayAliasUid: asString(raw.displayAliasUid) || asString(raw.displayName),
          text: asLocalized(raw.text),
          autoAdvance: raw.autoAdvance === true,
          command: asString(raw.command),
          // 后加的字段：字符串就是它的「指令内容」，其它（含老项目里的 undefined）当普通行
          specialContent: typeof raw.specialContent === 'string' ? raw.specialContent : null,
          // 后加的字段：字符串就是它引用的段落 uid，其它（含老项目里的 undefined）当普通行
          jumpGroupUid: typeof raw.jumpGroupUid === 'string' ? raw.jumpGroupUid : null,
          jumpConditions: Array.isArray(raw.jumpConditions)
            ? raw.jumpConditions.filter((item): item is string => typeof item === 'string')
            : [],
          optionIds: rawKind === '选项' ? optionIds : [],
          note: asString(raw.note),
        }),
      );
      continue;
    }

    migrated = true;

    // 挂在对话行上的指令，拆成紧挨在本行之前的「指令」行
    for (const item of legacyCommands ?? []) {
      const command = asString(item).trim();
      if (command !== '') lines.push(makeLine('指令', { command }));
    }

    const text = asLocalized(raw.text);
    const hasText = text.zh.trim() !== '' || text.en.trim() !== '' || text.ja.trim() !== '';
    // 老的「其他」行是演出 / 旁白行：有文本就留成对话行，
    // 只有指令、没有文本的那种就不再单独占一行。
    // 保留原可读 ID，好让重排时能算出对照表。
    if (rawKind !== '其他' || hasText) {
      lines.push(
        makeLine('对话', {
          uid: asUid(raw.uid),
          readableId: asString(raw.readableId),
          characterUid: asString(raw.characterUid) || asString(raw.characterId),
          displayAliasUid: asString(raw.displayAliasUid) || asString(raw.displayName),
          text,
          autoAdvance: raw.autoAdvance === true,
          note: asString(raw.note),
        }),
      );
    }

    // 挂在对话行上的选项，拆成紧随其后的一行「选项」
    if (optionIds.length > 0) lines.push(makeLine('选项', { optionIds }));
  }

  // 补齐过字段的行一定要装回去：老项目里没有后加的字段（比如「跳转到段落」的
  // jumpGroupUid），不装回去读到的就是 undefined，会被当成跳转行
  group.lines = lines;

  if (!migrated) return;

  // 插入了新行，段内编号必须重排；对照表交给界面提示本地化同事同步 key。
  // 新插入的行本来就没有旧 ID，不进对照表。
  changes.push(...renumberGroup(group, chapterId).filter((change) => change.oldId !== ''));
}
/* ---------- 指令字典：老格式 → 新格式 ---------- */

/** 老格式的一条字典定义（旧版 JSON 里的字段） */
interface OldCommandDef {
  uid: string;
  category: '条件' | '指令';
  head: string;
  branch: string;
  target: string;
  attribute: string;
  operator: string;
  value: string;
  fixedValues: string[];
  note: string;
}

/**
 * 老指令头（含点号的那一段）→ 新字典里的「主指令 + 分支」。
 *
 * 老字典靠 head 与 branch 两栏区分动作（剧情.演出 + 设置表情），新字典把它们
 * 合并成「剧情 / 演出」一条、动作变成参数，所以这里只需要一张 head 对照表。
 */
const OLD_HEAD_TO_NEW: Record<string, [string, string]> = {
  '剧情.演出': ['剧情', '演出'],
  '剧情.图片': ['剧情', '图片'],
  '剧情.CG': ['剧情', 'CG'],
  '剧情.播放对话': ['剧情', '播放对话'],
  '剧情.音效': ['剧情', '音效'],
  剧情: ['剧情', ''],
  '任务.接取': ['任务', '接取'],
  任务: ['任务', ''],
  背包: ['背包', ''],
  '地图.进入': ['地图', '进入'],
  '地图.时间': ['地图', '时间'],
  '地图.天数': ['地图', '天数'],
  特殊: ['特殊', ''],
};

/** 按第一个点号拆「主指令 / 分支」；没有点号时分支为空 */
function splitHead(head: string): [string, string] {
  const text = head.trim();
  const at = text.indexOf('.');
  if (at < 0) return [text, ''];
  return [text.slice(0, at).trim(), text.slice(at + 1).trim()];
}

function readOldDef(item: Record<string, unknown>): OldCommandDef {
  const category = item.category === '条件' ? '条件' : '指令';
  return {
    uid: asUid(item.uid),
    category,
    head: asString(item.head),
    branch: asString(item.branch),
    target: asString(item.target),
    attribute: asString(item.attribute),
    operator: asString(item.operator),
    value: asString(item.value),
    fixedValues: Array.isArray(item.fixedValues)
      ? item.fixedValues.filter((value): value is string => typeof value === 'string')
      : [],
    note: asString(item.note),
  };
}

const PARAM_SOURCES: readonly ParamSource[] = [
  'character',
  'item',
  'quest',
  'image',
  'sound',
  'line',
  'expression',
  'action',
  'number',
  'text',
  'fixed',
];

function readNewDef(item: Record<string, unknown>): CommandDef {
  const rawParams: unknown = item.params;
  return {
    uid: asUid(item.uid),
    category: item.category === '条件' ? '条件' : '指令',
    head: asString(item.head),
    branch: asString(item.branch),
    params: (Array.isArray(rawParams) ? rawParams : []).filter(isRecord).map((param) => ({
      uid: asUid(param.uid),
      name: asString(param.name),
      source: PARAM_SOURCES.includes(param.source as ParamSource)
        ? (param.source as ParamSource)
        : 'text',
      options: Array.isArray(param.options)
        ? param.options.filter((value): value is string => typeof value === 'string')
        : [],
      required: param.required !== false,
      note: asString(param.note),
    })),
    note: asString(item.note),
  };
}

/** 老字段里目标来源对应哪张表、叫什么参数名 */
const OLD_TARGET_SOURCE: Record<string, [ParamSource, string]> = {
  character: ['character', '角色'],
  item: ['item', '物品'],
  quest: ['quest', '任务'],
  image: ['image', '图片'],
  sound: ['sound', '音效'],
  line: ['line', '对话'],
  manual: ['text', '参数1'],
};

/** 老的「结果来源」对应哪种参数来源 */
function oldValueSource(value: string): ParamSource {
  switch (value) {
    case 'expression':
      return 'expression';
    case 'action':
      return 'action';
    case 'number':
      return 'number';
    case 'fixed':
      return 'fixed';
    default:
      return 'text';
  }
}

/** 自定义的老条目：按老字段尽力凑出一份新参数表 */
function oldDefToNew(old: OldCommandDef, head: string, branch: string): CommandDef {
  const params: CommandParamDef[] = [];
  const add = (
    name: string,
    source: ParamSource,
    options: string[] = [],
    required = true,
  ): void => {
    if (params.some((param) => param.name === name)) return;
    params.push({ uid: newUid(), name, source, options, required, note: '' });
  };

  const target = OLD_TARGET_SOURCE[old.target];
  if (target !== undefined && old.target !== 'manual') {
    add(target[1], target[0]);
  } else if (old.target === 'manual' && old.attribute === '' && old.operator === '') {
    add('参数1', 'text');
  }

  if (old.attribute !== '') {
    add(old.attribute, oldValueSource(old.value), [...old.fixedValues]);
  } else if (old.operator !== '') {
    add('运算符', 'fixed', [old.operator]);
  }

  if (old.attribute === '' && old.operator === '') {
    if (old.value === 'number') add('数量', 'number');
    else if (old.value === 'fixed' && old.fixedValues.length > 0) {
      add('结果', 'fixed', [...old.fixedValues]);
    }
  }

  return {
    uid: old.uid === '' ? newUid() : old.uid,
    category: old.category,
    head,
    branch,
    params,
    note: old.note,
  };
}

/**
 * 把老字典换成新字典。
 *
 * 老默认字典的每一条都能对上新的默认条目（见 OLD_HEAD_TO_NEW），直接换成那一份，
 * 这样迁移后文本里的参数名和字典里的参数名一定对得上；对不上的（用户自己加的）
 * 按老字段尽力凑一份参数表。
 */
function normalizeCommandDict(project: Project): void {
  const defaults = defaultCommandDefs();
  const raw = project.commands as unknown as Record<string, unknown>[];
  const out: CommandDef[] = [];

  for (const item of raw.filter(isRecord)) {
    // 已经是新格式：补齐字段就行
    if (Array.isArray(item.params)) {
      out.push(readNewDef(item));
      continue;
    }
    const old = readOldDef(item);
    const [head, branch] = OLD_HEAD_TO_NEW[old.head.trim()] ?? splitHead(old.head);
    const fallback = defaults.find(
      (def) => def.category === old.category && def.head === head && def.branch === branch,
    );
    out.push(
      fallback === undefined
        ? oldDefToNew(old, head, branch)
        : { ...structuredClone(fallback), uid: old.uid === '' ? newUid() : old.uid },
    );
  }

  // 同一个「类别 + 主指令 + 分支」只留一条：老字典里靠 branch 区分的那几条会合并到这里
  const seen = new Set<string>();
  project.commands = out.filter((def) => {
    const key = `${def.category}|${def.head.trim()}|${def.branch.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------- 指令文本：老格式 → E2 ---------- */

interface LegacyCommand {
  name: string;
  branch: string;
  target: string;
  attribute: string;
  operator: string;
  value: string;
}

/**
 * 解析老格式的指令：主指令[.分支]# 目标对象[.目标属性][运算符 目标结果]
 *
 * 只给迁移用。老格式的三处歧义（uid / ID 里的 `-`、属性前的点）都要小心处理，
 * 这里先按已知 uid 切目标，再用一条「ID 形态 + 运算符」的正则兜住
 * `剧情# Dia_ch01_001-2=1` 这种把 `-` 吃成减号的情况。
 */
function parseLegacyCommand(
  text: string,
  isUid: (value: string) => boolean,
): LegacyCommand | null {
  const head = /^\s*([^.#]+)(?:\.([^#]+))?#\s*(.*?)\s*$/.exec(text);
  if (head === null) return null;

  const name = head[1].trim();
  const branch = (head[2] ?? '').trim();
  const rest = head[3];

  for (let end = rest.length; end > 0; end -= 1) {
    const candidate = rest.slice(0, end);
    if (isUid(candidate)) {
      const tail = legacyTailOf(rest.slice(candidate.length));
      return { name, branch, target: candidate, ...tail };
    }
  }

  const base: LegacyCommand = { name, branch, target: '', attribute: '', operator: '', value: '' };

  // 整体就是一个带尾号的 ID，例如 P_Test_001-1、Task_Test_01
  const plainId = /^([A-Za-z][A-Za-z0-9_]*-\d+)$/.exec(rest);
  if (plainId !== null) return { ...base, target: plainId[1] };

  // ID 后面直接跟运算符：剧情# Dia_ch01_001-2=1 里的 `-` 是 ID 的一部分
  const idWithValue = /^([A-Za-z][A-Za-z0-9_]*-\d+)\s*(>=|<=|==|!=|>|<|\+|-|=)\s*(.*?)$/.exec(rest);
  if (idWithValue !== null) {
    return {
      name,
      branch,
      target: idWithValue[1],
      attribute: '',
      operator: idWithValue[2],
      value: idWithValue[3],
    };
  }

  // 整条只有「运算符 + 数字」：地图.时间# +1、地图.天数# =3
  const operatorOnly = /^(>=|<=|==|!=|>|<|\+|-|=)\s*(.*?)$/.exec(rest);
  if (operatorOnly !== null) {
    return {
      name,
      branch,
      target: '',
      attribute: '',
      operator: operatorOnly[1],
      value: operatorOnly[2],
    };
  }

  const withValue = /^([^.\s]+?)(?:\.([^\s=+\-]+))?\s*(>=|<=|==|!=|>|<|\+|-|=)\s*(.*?)$/.exec(
    rest,
  );
  if (withValue !== null) {
    return {
      name,
      branch,
      target: withValue[1],
      attribute: withValue[2] ?? '',
      operator: withValue[3],
      value: withValue[4],
    };
  }

  const targetOnly = /^([^.\s]+?)(?:\.([^\s=+\-]+))?$/.exec(rest);
  if (targetOnly !== null) {
    return { ...base, target: targetOnly[1], attribute: targetOnly[2] ?? '' };
  }

  return null;
}

/** 目标已经被切掉，剩下的只有「.属性」与「运算符 结果」 */
function legacyTailOf(
  tail: string,
): Pick<LegacyCommand, 'attribute' | 'operator' | 'value'> {
  const withValue = /^(?:\.([^\s=+\-]+))?\s*(>=|<=|==|!=|>|<|\+|-|=)\s*(.*?)$/.exec(tail);
  if (withValue !== null) {
    return { attribute: withValue[1] ?? '', operator: withValue[2], value: withValue[3] };
  }
  const attributeOnly = /^\.([^\s=+\-]+)$/.exec(tail);
  return { attribute: attributeOnly?.[1] ?? '', operator: '', value: '' };
}

interface NewCommandText {
  head: string;
  branch: string;
  params: { name: string; value: string }[];
}

/** 拼回 E2 文本；参数名为空或值为空的那一项不写 */
function joinCommandText(text: NewCommandText): string {
  const rest = text.params
    .filter((param) => param.name.trim() !== '' && param.value.trim() !== '')
    .map((param) => `${param.name.trim()}:${param.value.trim()}`)
    .join(';');
  return `${text.head.trim()}|${text.branch.trim()}|${rest}`;
}

/** 老文本对应到新格式：主指令 / 分支 / 参数（参数名按新默认字典的写法） */
function legacyCommandToText(
  legacy: LegacyCommand,
  category: '条件' | '指令',
): NewCommandText {
  const full = legacy.branch === '' ? legacy.name : `${legacy.name}.${legacy.branch}`;
  const target = legacy.target.trim();
  const attribute = legacy.attribute.trim();
  const operator = legacy.operator.trim();
  const value = legacy.value.trim();
  const params: { name: string; value: string }[] = [];
  const add = (name: string, text: string): void => {
    if (text !== '') params.push({ name, value: text });
  };

  switch (full) {
    case '剧情.演出': {
      add('角色', target);
      if (attribute === '进入' || attribute === '退出') add('立绘位移', attribute);
      else if (attribute === '表情') add('表情', value);
      else if (attribute === '动作') add('动作', value);
      else add(attribute, value);
      return { head: '剧情', branch: '演出', params };
    }
    case '剧情.图片':
      add('图片', target === '移除' ? '' : target);
      return { head: '剧情', branch: '图片', params };
    case '剧情.CG':
      add('CG', target === '移除' ? '' : target);
      return { head: '剧情', branch: 'CG', params };
    case '剧情.播放对话':
      add('对话', target);
      return { head: '剧情', branch: '播放对话', params };
    case '剧情.音效':
      add('音效', target);
      return { head: '剧情', branch: '音效', params };
    case '背包':
      add('物品', target);
      add('运算符', operator);
      add('数量', value);
      return { head: '背包', branch: '', params };
    case '任务.接取':
      add('任务', target);
      return { head: '任务', branch: '接取', params };
    case '任务':
      add('任务', target);
      add('运算符', operator);
      add('结果', value);
      return { head: '任务', branch: '', params };
    case '剧情':
      add('对话', target);
      add('运算符', operator);
      add('结果', value);
      return { head: '剧情', branch: '', params };
    case '特殊':
      if (category === '条件') {
        add('特殊条件', target);
        add('运算符', operator);
        add('结果', value);
      } else {
        add('特殊指令', target);
      }
      return { head: '特殊', branch: '', params };
    case '地图.进入':
      add('地图', target);
      return { head: '地图', branch: '进入', params };
    case '地图.时间':
      add('运算符', operator);
      add('小时', value);
      return { head: '地图', branch: '时间', params };
    case '地图.天数':
      add('运算符', operator);
      add('天数', value);
      return { head: '地图', branch: '天数', params };
    default: {
      // 字典里没有的老指令：参数原样兜住，条目由 ensureCommandDef 补
      const [head, branch] = splitHead(full);
      const rest = `${target}${attribute === '' ? '' : `.${attribute}`}${operator}${value}`;
      return { head, branch, params: [{ name: '参数1', value: rest }] };
    }
  }
}

/** 字典里没有这条（主指令 + 分支）时补一条，参数按迁移时用到的名字各建一个 */
function ensureCommandDef(
  project: Project,
  category: '条件' | '指令',
  text: NewCommandText,
): void {
  const exists = findCommandDef(project.commands, category, text.head, text.branch);
  if (exists !== undefined) return;
  project.commands.push({
    uid: newUid(),
    category,
    head: text.head,
    branch: text.branch,
    params: text.params.map((param) => ({
      uid: newUid(),
      name: param.name,
      source: 'text' as ParamSource,
      options: [],
      required: true,
      note: '自动迁移出来的参数，请核对值来源',
    })),
    note: '自动迁移出来的指令，请核对参数',
  });
}

/** 把剧情里所有指令 / 条件文本从老格式改写成 E2；已经是新格式的原样保留 */
function migrateCommandTexts(project: Project): void {
  const uids = collectRefUids(project);
  const isUid = (value: string): boolean => uids.has(value);

  const convert = (text: string, category: '条件' | '指令'): string => {
    const trimmed = text.trim();
    if (trimmed === '') return text;
    if (parseCommandText(trimmed) !== null) return text; // 已经是新格式
    const legacy = parseLegacyCommand(trimmed, isUid);
    if (legacy === null) return text;
    const mapped = legacyCommandToText(legacy, category);
    ensureCommandDef(project, category, mapped);
    return joinCommandText(mapped);
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        if (line.kind === '指令' && line.jumpGroupUid === null) {
          line.command = convert(line.command, '指令');
        }
        line.jumpConditions = line.jumpConditions.map((text) => convert(text, '条件'));
      }
      for (const option of group.options) {
        option.appearConditions = option.appearConditions.map((text) => convert(text, '条件'));
        option.enableConditions = option.enableConditions.map((text) => convert(text, '条件'));
      }
    }
  }
}

/* ---------- 选项的「结果」：换成新段落里的指令行 ---------- */

/** 选项下一段的数字 ID（001、002…） */
function nextGroupId(chapter: Chapter): string {
  let max = 0;
  for (const group of chapter.groups) {
    const n = Number.parseInt(group.id, 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max + 1).padStart(3, '0');
}

/**
 * 老版本的「选项结果」搬成新段落。
 *
 * 新版本里选项不再带结果：选完要执行一串指令，就让选项跳到那个段落。
 * 所以这里给每个带结果的选项建一个段落（每个结果一条指令行），末尾再用
 * 「跳转到段落」指回它原来要去的段落；选项的跳转改成指向这个新段落。
 */
function migrateOptionResults(project: Project): void {
  for (const chapter of project.chapters) {
    const lineGroup = new Map<string, Group>();
    for (const group of chapter.groups) {
      for (const line of group.lines) lineGroup.set(line.uid, group);
    }

    for (const group of [...chapter.groups]) {
      for (const option of group.options as (StoryOption & { results?: unknown })[]) {
        const raw: unknown = option.results;
        const results = (Array.isArray(raw) ? raw : []).filter(
          (text): text is string => typeof text === 'string' && text.trim() !== '',
        );
        delete option.results;
        if (results.length === 0) continue;

        const id = nextGroupId(chapter);
        const target =
          option.nextId === ''
            ? undefined
            : (lineGroup.get(option.nextId) ??
              (groupUidOfFirstLine(option.nextId) === null
                ? undefined
                : chapter.groups.find((item) => item.uid === groupUidOfFirstLine(option.nextId))));

        const next: Group = {
          uid: newUid(),
          id,
          title: '（选项结果）',
          note: '',
          lines: results.map((text, index) =>
            makeLine('指令', {
              readableId: makeLineId(chapter.id, id, index + 1),
              command: text.trim(),
            }),
          ),
          options: [],
        };
        // 原来的跳转目标还在本章里：末尾补一条「跳转到段落」接回去
        if (target !== undefined) {
          next.lines.push(
            makeLine('指令', {
              readableId: makeLineId(chapter.id, id, results.length + 1),
              jumpGroupUid: target.uid,
            }),
          );
        }
        option.nextId = firstLineRef(next.uid);
        chapter.groups.push(next);
      }
    }
  }
}
