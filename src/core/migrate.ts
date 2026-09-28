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
import { newUid, renumberGroup, type IdChange } from './ids';
import type {
  BattleData,
  Chapter,
  GasModifier,
  GasPair,
  Group,
  Line,
  LineKind,
  LocalizedText,
  Project,
} from './types';

export interface NormalizeResult {
  project: Project;
  /** 迁移造成的可读 ID 变化；空数组表示本来就是新结构 */
  changes: IdChange[];
}

/** 读取时用的宽松行：字段可能是任何类型，逐个收窄 */
interface RawLine extends Partial<Line> {
  commands?: unknown;
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
    characterId: '',
    displayName: '',
    text: { zh: '', en: '', ja: '' },
    autoAdvance: false,
    command: '',
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

  // 战斗模块也是后加的：缺哪张表补哪张，路径前缀缺了就用默认值
  project.battle = normalizeBattle(project.battle);

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

  for (const character of project.characters) {
    if (!Array.isArray(character.expressions)) character.expressions = [];
    if (!Array.isArray(character.actions)) character.actions = [];
  }

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

  return { project, changes };
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
      attribute: asString(row.attribute),
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
      lockSkills: names(row.lockSkills),
      listenEvents: names(row.listenEvents),
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
      skills: names(row.skills),
    })),
    weapons: rows('weapons').map((row) => ({
      uid: asUid(row.uid),
      id: text(row, 'id'),
      name: text(row, 'name'),
      description: text(row, 'description'),
      magazine: text(row, 'magazine'),
      attackSpeed: text(row, 'attackSpeed'),
      modifiers: modifiers(row.modifiers),
      skills: names(row.skills),
    })),
  };
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
          characterId: asString(raw.characterId),
          displayName: asString(raw.displayName),
          text: asLocalized(raw.text),
          autoAdvance: raw.autoAdvance === true,
          command: asString(raw.command),
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
          characterId: asString(raw.characterId),
          displayName: asString(raw.displayName),
          text,
          autoAdvance: raw.autoAdvance === true,
          note: asString(raw.note),
        }),
      );
    }

    // 挂在对话行上的选项，拆成紧随其后的一行「选项」
    if (optionIds.length > 0) lines.push(makeLine('选项', { optionIds }));
  }

  if (!migrated) return;

  group.lines = lines;
  // 插入了新行，段内编号必须重排；对照表交给界面提示本地化同事同步 key。
  // 新插入的行本来就没有旧 ID，不进对照表。
  changes.push(...renumberGroup(group, chapterId).filter((change) => change.oldId !== ''));
}
