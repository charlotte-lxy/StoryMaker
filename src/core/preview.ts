/**
 * 剧情预览的播放执行器。
 *
 * 输入是项目数据，输出是一份「当前播到哪儿、画面上有什么」的运行时状态：
 * 纯函数、不碰 DOM、不碰音频，所以可以直接单测。
 *
 * 播放规则（和导出保持同一套语义，但**不依赖** readableId 的连续性）：
 *   - 对话行     —— 停住，等玩家点「继续」（或自动播放）
 *   - 指令行     —— 执行后立刻往下走，除非是「延时」（等 N 秒）
 *   - 选项行     —— 停住，摆出这一行的选项
 *   - 跳转到段落 —— 跳到目标段落的第一行
 *   - 段落末尾   —— 停住，给出「下一段」的 uid，由界面决定要不要继续
 *
 * 指令靠「主指令 + 分支」识别语义；参数名被策划改过时，先按字典里参数的
 * 「值来源」找，再退回默认参数名——这样改参数名不会让预览立刻瞎掉。
 * 字典里没有的指令只记一条日志，不中断播放。
 */

import {
  findCommandDef,
  isReferenceSource,
  paramValuesOf,
  parseCommandText,
} from './command-build';
import { groupUidOfFirstLine, isContinueTarget } from './ids';
import { collectRefMaps } from './refs';
import type {
  Character,
  CommandDef,
  Group,
  Line,
  LocalizedText,
  ParamSource,
  Project,
  StoryOption,
} from './types';

/** 播到哪一步了 */
export type PreviewStatus = 'line' | 'options' | 'delay' | 'finished' | 'blocked';

export interface PreviewCursor {
  groupUid: string;
  lineIndex: number;
}

/** 舞台上某个角色的状态（立绘位置按上场顺序排：左 / 中 / 右） */
export interface PreviewCharacterState {
  characterUid: string;
  /** 当前表情名；'' 表示用默认立绘 */
  expression: string;
  entered: boolean;
  /** 第几个上场，界面据此摆位；超过 3 个时叠在右侧错开 */
  slot: number;
}

export interface PreviewStage {
  /** `剧情|图片` 当前显示的图片（图片行 uid）；'' 表示没显示 */
  backgroundImageUid: string;
  /** `剧情|CG` 的 ID；'' 表示没在播 */
  cgId: string;
  characters: PreviewCharacterState[];
}

export interface PreviewLogEntry {
  level: 'info' | 'warn';
  text: string;
  /** 这条日志由哪一行产生 */
  lineUid?: string;
  /** 要播的音效（音效行 uid）；界面按日志增量播放 */
  soundUid?: string;
}

export interface PreviewLineState {
  lineUid: string;
  groupUid: string;
  characterUid: string;
  aliasUid: string;
  text: LocalizedText;
  playPositionUid: string;
  autoAdvance: boolean;
}

export interface PreviewOptionState {
  optionUid: string;
  text: LocalizedText;
  appearConditions: string[];
  enableConditions: string[];
}

export interface PreviewState {
  status: PreviewStatus;
  cursor: PreviewCursor;
  stage: PreviewStage;
  current: PreviewLineState | null;
  options: PreviewOptionState[];
  /** 延时指令还剩几秒（status === 'delay' 时有效） */
  delaySeconds: number;
  /** 本段播完时，本章下一段的 uid；'' 表示没有 */
  nextGroupUid: string;
  log: PreviewLogEntry[];
  /** 「上一句」用的快照，栈顶是最近一次停住之前的状态 */
  history: PreviewSnapshot[];
}

/** 历史快照：状态本身，但不带历史（不然会无限套娃） */
export type PreviewSnapshot = Omit<PreviewState, 'history'>;

export interface PreviewStart {
  groupUid: string;
  /** 从这一行开始；不传就从段落第一行开始 */
  lineUid?: string;
}

/** 一条指令最多跳多少次，防止选项 / 播放对话绕成环把界面卡死 */
const MAX_STEPS = 300;

/** 「上一句」最多能退多少步 */
const MAX_HISTORY = 50;

/* ---------- 对外的小工具 ---------- */

export function emptyStage(): PreviewStage {
  return { backgroundImageUid: '', cgId: '', characters: [] };
}

/** 按 uid 找段落 */
export function previewGroupOf(project: Project, groupUid: string): Group | undefined {
  for (const chapter of project.chapters) {
    const group = chapter.groups.find((item) => item.uid === groupUid);
    if (group !== undefined) return group;
  }
  return undefined;
}

/** 本章里的下一个段落；没有时返回空串 */
export function nextGroupUidOf(project: Project, groupUid: string): string {
  for (const chapter of project.chapters) {
    const index = chapter.groups.findIndex((item) => item.uid === groupUid);
    if (index < 0) continue;
    return chapter.groups[index + 1]?.uid ?? '';
  }
  return '';
}

/** 角色在这一句里显示什么名字：别名 → 默认名称 → 角色 ID */
export function previewSpeakerName(
  project: Project,
  characterUid: string,
  aliasUid: string,
): string {
  const character = project.characters.find((item) => item.uid === characterUid);
  if (character === undefined) return '';
  const alias = character.aliases.find((item) => item.uid === aliasUid);
  if (alias !== undefined && alias.text.trim() !== '') return alias.text.trim();
  return character.name.trim() !== '' ? character.name.trim() : character.id;
}

/** 播放位置名（台词框摆哪儿由界面判断） */
export function previewPositionName(project: Project, positionUid: string): string {
  if (positionUid.trim() === '') return '';
  return project.playPositions.find((item) => item.uid === positionUid)?.name ?? '';
}

/**
 * 当前停住的是哪一行——界面用它高亮，并在「锁定到对话」时滚到列表中间。
 *
 * 延时状态的游标已经指向「延时之后的那一行」，要往回退一格；
 * 播完 / 出问题时没有当前行。
 */
export function previewActiveLineUid(project: Project, state: PreviewState): string {
  if (state.status === 'finished' || state.status === 'blocked') return '';
  const group = previewGroupOf(project, state.cursor.groupUid);
  if (group === undefined) return '';
  const index = state.status === 'delay' ? state.cursor.lineIndex - 1 : state.cursor.lineIndex;
  return group.lines[index]?.uid ?? '';
}

/** 角色表里那一行 */
export function previewCharacterOf(project: Project, characterUid: string): Character | undefined {
  return project.characters.find((item) => item.uid === characterUid);
}

/**
 * 把一条指令 / 条件文本翻成可读说明，给选项条件小字和播放日志用。
 *
 * 指向各张表的参数（存的是 uid）会翻成可读 ID / 名字；字典里没这条时原样输出。
 */
export function describeCommand(
  project: Project,
  text: string,
  category: '条件' | '指令',
): string {
  const parsed = parseCommandText(text);
  if (parsed === null) return text.trim();
  const label = parsed.branch === '' ? parsed.head : `${parsed.head} · ${parsed.branch}`;
  if (parsed.params.length === 0) return label;

  const def = findCommandDef(project.commands, category, parsed.head, parsed.branch);
  const idOf = collectRefMaps(project).byUid;
  const parts = parsed.params.map((param) => {
    const paramDef = def?.params.find((item) => item.name === param.name);
    const value =
      paramDef !== undefined && isReferenceSource(paramDef.source)
        ? (idOf.get(param.value) ?? param.value)
        : param.value;
    return `${param.name} ${value}`;
  });
  return `${label}｜${parts.join('，')}`;
}

/* ---------- 启动与推进 ---------- */

export function startPreview(project: Project, start: PreviewStart): PreviewState {
  const group = previewGroupOf(project, start.groupUid);
  const lineIndex =
    group === undefined
      ? 0
      : Math.max(
          0,
          start.lineUid === undefined
            ? 0
            : group.lines.findIndex((line) => line.uid === start.lineUid),
        );

  const base: PreviewState = {
    status: 'line',
    cursor: { groupUid: start.groupUid, lineIndex },
    stage: emptyStage(),
    current: null,
    options: [],
    delaySeconds: 0,
    nextGroupUid: '',
    log: [],
    history: [],
  };

  if (group === undefined) return finish(project, base, '找不到这个段落，预览无法开始');
  return run(project, base, 0);
}

/** 点「继续」：对话往前走一行；延时状态下直接接着跑 */
export function advance(project: Project, state: PreviewState): PreviewState {
  if (state.status === 'delay') {
    return run(project, { ...state, status: 'line', delaySeconds: 0 }, 0);
  }
  if (state.status !== 'line') return state;

  return run(
    project,
    {
      ...state,
      cursor: { ...state.cursor, lineIndex: state.cursor.lineIndex + 1 },
      status: 'line',
      current: null,
      options: [],
      delaySeconds: 0,
      nextGroupUid: '',
      history: pushHistory(state),
    },
    0,
  );
}

/** 选了某个选项 */
export function chooseOption(
  project: Project,
  state: PreviewState,
  optionUid: string,
): PreviewState {
  if (state.status !== 'options') return state;

  const group = previewGroupOf(project, state.cursor.groupUid);
  const option = group?.options.find((item) => item.uid === optionUid);
  if (group === undefined || option === undefined) return state;

  const history = pushHistory(state);
  const target = resolveNext(project, option, group, state.cursor.lineIndex);
  const label = option.text.zh.trim() === '' ? option.readableId : option.text.zh.trim();

  if (target.kind === 'end') {
    return finish(project, { ...state, history }, `选项「${label}」没有下一句，播放结束`);
  }
  if (target.kind === 'missing') {
    return finish(project, { ...state, history }, `选项「${label}」的下一句不在项目里，播放结束`);
  }
  return run(
    project,
    {
      ...state,
      cursor: target.cursor,
      status: 'line',
      current: null,
      options: [],
      delaySeconds: 0,
      nextGroupUid: '',
      history,
    },
    0,
  );
}

/** 本段播完 → 继续下一段（舞台和日志都保留，像连播） */
export function continueToNextGroup(
  project: Project,
  state: PreviewState,
): PreviewState {
  const nextUid = nextGroupUidOf(project, state.cursor.groupUid);
  const target = nextUid === '' ? undefined : previewGroupOf(project, nextUid);
  if (target === undefined) return state;

  return run(
    project,
    {
      ...state,
      status: 'line',
      cursor: { groupUid: target.uid, lineIndex: 0 },
      current: null,
      options: [],
      delaySeconds: 0,
      nextGroupUid: '',
      history: pushHistory(state),
      log: [
        ...state.log,
        {
          level: 'info',
          text: `—— 进入段落「${target.title.trim() === '' ? target.id : target.title}」——`,
        },
      ],
    },
    0,
  );
}

/** 重播本段：舞台、日志、历史全部从头来 */
export function restartGroup(project: Project, state: PreviewState): PreviewState {
  const group = previewGroupOf(project, state.cursor.groupUid);
  if (group === undefined) return state;

  return run(
    project,
    {
      status: 'line',
      cursor: { groupUid: group.uid, lineIndex: 0 },
      stage: emptyStage(),
      current: null,
      options: [],
      delaySeconds: 0,
      nextGroupUid: '',
      log: [],
      history: [],
    },
    0,
  );
}

/** 上一句：回到上一个停住的地方 */
export function stepBack(state: PreviewState): PreviewState {
  const previous = state.history[state.history.length - 1];
  if (previous === undefined) return state;
  return { ...previous, history: state.history.slice(0, -1) };
}

/* ---------- 内部实现 ---------- */

function snapshotOf(state: PreviewState): PreviewSnapshot {
  const { history: _history, ...rest } = state;
  return rest;
}

function pushHistory(state: PreviewState): PreviewSnapshot[] {
  return [...state.history, snapshotOf(state)].slice(-MAX_HISTORY);
}

function info(text: string, lineUid?: string): PreviewLogEntry {
  return { level: 'info', text, lineUid };
}

function warn(text: string, lineUid?: string): PreviewLogEntry {
  return { level: 'warn', text, lineUid };
}

/** 播到段落末尾 */
function finish(project: Project, state: PreviewState, note?: string): PreviewState {
  return {
    ...state,
    status: 'finished',
    current: null,
    options: [],
    delaySeconds: 0,
    nextGroupUid: nextGroupUidOf(project, state.cursor.groupUid),
    log: note === undefined ? state.log : [...state.log, info(note)],
  };
}

/**
 * 从游标处一直执行到「需要停住」的地方。
 *
 * 指令行和跳转行会在循环里连续执行掉，所以一次 advance 可能跨过好几行。
 */
function run(project: Project, state: PreviewState, steps: number): PreviewState {
  if (steps > MAX_STEPS) {
    return {
      ...state,
      status: 'blocked',
      current: null,
      options: [],
      delaySeconds: 0,
      log: [
        ...state.log,
        warn('跳转次数过多，可能选项或「播放对话」绕成了环，预览已停下'),
      ],
    };
  }

  const group = previewGroupOf(project, state.cursor.groupUid);
  if (group === undefined) return finish(project, state, '找不到当前段落，播放结束');

  const line = group.lines[state.cursor.lineIndex];
  if (line === undefined) {
    const heading = group.title.trim() === '' ? group.id : group.title;
    return {
      ...state,
      status: 'finished',
      current: null,
      options: [],
      delaySeconds: 0,
      nextGroupUid: nextGroupUidOf(project, group.uid),
      log: [...state.log, info(`「${heading}」播完了`)],
    };
  }

  if (line.kind === '对话') {
    const character = previewCharacterOf(project, line.characterUid);
    return {
      ...state,
      status: 'line',
      current: {
        lineUid: line.uid,
        groupUid: group.uid,
        characterUid: line.characterUid,
        aliasUid: line.displayAliasUid,
        text: line.text,
        playPositionUid: character?.playPosition ?? '',
        autoAdvance: line.autoAdvance,
      },
      options: [],
      delaySeconds: 0,
      nextGroupUid: '',
    };
  }

  if (line.kind === '选项') {
    const options = line.optionIds
      .map((uid) => group.options.find((item) => item.uid === uid))
      .filter((item): item is StoryOption => item !== undefined)
      .map((option) => ({
        optionUid: option.uid,
        text: option.text,
        appearConditions: option.appearConditions,
        enableConditions: option.enableConditions,
      }));

    if (options.length === 0) {
      return run(
        project,
        {
          ...state,
          cursor: { ...state.cursor, lineIndex: state.cursor.lineIndex + 1 },
          log: [...state.log, warn('这一行是「选项」，但下面一个选项都没有，已跳过', line.uid)],
        },
        steps + 1,
      );
    }

    return {
      ...state,
      status: 'options',
      current: null,
      options,
      delaySeconds: 0,
      nextGroupUid: '',
    };
  }

  return runCommand(project, state, line, steps);
}

/** 执行一条「指令」行 */
function runCommand(
  project: Project,
  state: PreviewState,
  line: Line,
  steps: number,
): PreviewState {
  const nextCursor: PreviewCursor = {
    ...state.cursor,
    lineIndex: state.cursor.lineIndex + 1,
  };

  // 「跳转到段落」：指令内容由段落现拼，预览直接跳过去
  if (line.jumpGroupUid !== null) {
    const target =
      line.jumpGroupUid === '' ? undefined : previewGroupOf(project, line.jumpGroupUid);
    if (target === undefined) {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          log: [
            ...state.log,
            warn('「跳转到段落」还没选段落，已跳过', line.uid),
          ],
        },
        steps + 1,
      );
    }
    const conditionNote =
      line.jumpConditions.length === 0
        ? ''
        : `（可用条件 ${line.jumpConditions.length} 条，预览不判定）`;
    return run(
      project,
      {
        ...state,
        cursor: { groupUid: target.uid, lineIndex: 0 },
        log: [
          ...state.log,
          info(
            `跳转到段落「${target.title.trim() === '' ? target.id : target.title}」${conditionNote}`,
            line.uid,
          ),
        ],
      },
      steps + 1,
    );
  }

  const parsed = parseCommandText(line.command);
  if (parsed === null) {
    return run(
      project,
      {
        ...state,
        cursor: nextCursor,
        log: [
          ...state.log,
          warn(
            line.command.trim() === ''
              ? '「指令」行还没填指令，已跳过'
              : `指令格式不对：${line.command.trim()}`,
            line.uid,
          ),
        ],
      },
      steps + 1,
    );
  }

  const def = findCommandDef(project.commands, '指令', parsed.head, parsed.branch);
  const values = paramValuesOf(parsed);
  const read = (names: string[], sources: ParamSource[] = []): string =>
    readParam(def, values, names, sources);

  // 剧情 · 演出：角色上场 / 退场 / 换表情
  if (parsed.head === '剧情' && parsed.branch === '演出') {
    const characterRef = read(['角色'], ['character']);
    const move = read(['立绘位移']);
    const expression = read(['表情'], ['expression']);
    const action = read(['动作'], ['action']);
    const applied = applyPerformance(project, state.stage, characterRef, move, expression);
    const entries = [...applied.entries];
    if (action !== '') entries.push(info(`动作「${action}」（预览不模拟）`, line.uid));
    return run(
      project,
      { ...state, cursor: nextCursor, stage: applied.stage, log: [...state.log, ...entries] },
      steps + 1,
    );
  }

  // 剧情 · 图片：换背景；不填 = 清掉
  if (parsed.head === '剧情' && parsed.branch === '图片') {
    const ref = read(['图片'], ['image']);
    if (ref === '') {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          stage: { ...state.stage, backgroundImageUid: '' },
          log: [...state.log, info('清掉当前图片', line.uid)],
        },
        steps + 1,
      );
    }
    const row = project.images.find((item) => item.uid === ref);
    if (row === undefined) {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          log: [...state.log, warn('指令里的图片不在图片表里，已跳过', line.uid)],
        },
        steps + 1,
      );
    }
    return run(
      project,
      {
        ...state,
        cursor: nextCursor,
        stage: { ...state.stage, backgroundImageUid: row.uid },
        log: [
          ...state.log,
          info(`显示图片「${row.name.trim() === '' ? row.id : row.name.trim()}」`, line.uid),
        ],
      },
      steps + 1,
    );
  }

  // 剧情 · CG：没有素材，只把 CG 号摆到画面上
  if (parsed.head === '剧情' && parsed.branch === 'CG') {
    const value = read(['CG'], ['text']);
    return run(
      project,
      {
        ...state,
        cursor: nextCursor,
        stage: { ...state.stage, cgId: value },
        log: [
          ...state.log,
          info(
            value === '' ? '停止播放 CG' : `播放 CG「${value}」（预览只显示这个号）`,
            line.uid,
          ),
        ],
      },
      steps + 1,
    );
  }

  // 剧情 · 播放对话：跳到另一行
  if (parsed.head === '剧情' && parsed.branch === '播放对话') {
    const ref = read(['对话'], ['line']);
    const target = ref === '' ? undefined : locateLine(project, ref);
    if (target === undefined) {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          log: [...state.log, warn('要播放的对话不在项目里，已跳过', line.uid)],
        },
        steps + 1,
      );
    }
    return run(
      project,
      {
        ...state,
        cursor: target,
        log: [...state.log, info(`播放对话 ${describeLineRef(project, target)}`, line.uid)],
      },
      steps + 1,
    );
  }

  // 剧情 · 音效：日志里带 soundUid，界面按增量播放
  if (parsed.head === '剧情' && parsed.branch === '音效') {
    const ref = read(['音效'], ['sound']);
    const row = project.sounds.find((item) => item.uid === ref);
    if (row === undefined) {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          log: [...state.log, warn('指令里的音效不在音效表里，已跳过', line.uid)],
        },
        steps + 1,
      );
    }
    return run(
      project,
      {
        ...state,
        cursor: nextCursor,
        log: [
          ...state.log,
          {
            level: 'info',
            text: `播放音效「${row.name.trim() === '' ? row.id : row.name.trim()}」`,
            lineUid: line.uid,
            soundUid: row.uid,
          },
        ],
      },
      steps + 1,
    );
  }

  // 其他 · 延时：停下来等 N 秒
  if (parsed.head === '其他' && parsed.branch === '延时') {
    const seconds = Number(read(['时长'], ['number']));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return run(
        project,
        {
          ...state,
          cursor: nextCursor,
          log: [...state.log, warn(`延时的秒数不合法（${read(['时长'], ['number'])}），已跳过`, line.uid)],
        },
        steps + 1,
      );
    }
    return {
      ...state,
      status: 'delay',
      cursor: nextCursor,
      current: null,
      options: [],
      delaySeconds: seconds,
      nextGroupUid: '',
      log: [...state.log, info(`延时 ${seconds} 秒`, line.uid)],
    };
  }

  // 其他 · 特殊：预览不模拟（UE 那边的脚本行为）
  if (parsed.head === '其他' && parsed.branch === '特殊') {
    const name = read(['特殊指令ID'], ['text']);
    return run(
      project,
      {
        ...state,
        cursor: nextCursor,
        log: [
          ...state.log,
          info(`特殊指令「${name === '' ? '（没填名字）' : name}」在 UE 里执行，预览不模拟`, line.uid),
        ],
      },
      steps + 1,
    );
  }

  // 背包 / 任务 / 地图……以及字典里的自定义指令：不改画面，记一笔就往下走
  return run(
    project,
    {
      ...state,
      cursor: nextCursor,
      log: [...state.log, info(`「${describeCommand(project, line.command, '指令')}」不影响画面，已忽略`, line.uid)],
    },
    steps + 1,
  );
}

/** 取参数值：先按字典里的「值来源」找，找不到再退回参数名 */
function readParam(
  def: CommandDef | undefined,
  values: Record<string, string>,
  names: readonly string[],
  sources: readonly ParamSource[],
): string {
  for (const source of sources) {
    const paramDef = def?.params.find((item) => item.source === source);
    if (paramDef === undefined) continue;
    const value = values[paramDef.name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  for (const name of names) {
    const value = values[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

interface PerformanceResult {
  stage: PreviewStage;
  entries: PreviewLogEntry[];
}

/** 剧情|演出的舞台效果 */
function applyPerformance(
  project: Project,
  stage: PreviewStage,
  characterRef: string,
  move: string,
  expression: string,
): PerformanceResult {
  const character = previewCharacterOf(project, characterRef);
  if (character === undefined) {
    return { stage, entries: [warn('指令里的角色不在角色表里，已跳过')] };
  }

  const name = character.name.trim() === '' ? character.id : character.name.trim();
  const existing = stage.characters.find((item) => item.characterUid === character.uid);

  if (move === '退出') {
    if (existing === undefined || !existing.entered) {
      return { stage, entries: [warn(`${name} 还没上场，退出没有效果`)] };
    }
    return {
      stage: {
        ...stage,
        characters: stage.characters.map((item) =>
          item.characterUid === character.uid ? { ...item, entered: false } : item,
        ),
      },
      entries: [info(`${name} 退场`)],
    };
  }

  const entries: PreviewLogEntry[] = [];

  if (existing === undefined) {
    // 没写「进入」也照样上场：比 UE 宽容一点，并在日志里说清楚
    entries.push(
      move === '进入'
        ? info(`${name} 上场${expression === '' ? '' : `，表情：${expression}`}`)
        : info(`${name} 自动上场（这行没写「进入」）${expression === '' ? '' : `，表情：${expression}`}`),
    );
    return {
      stage: {
        ...stage,
        characters: [
          ...stage.characters,
          { characterUid: character.uid, expression, entered: true, slot: stage.characters.length },
        ],
      },
      entries,
    };
  }

  if (move === '进入' && !existing.entered) {
    entries.push(info(`${name} 重新上场`));
  }
  if (expression !== '') {
    entries.push(info(`${name} 换表情：${expression}`));
  }
  if (entries.length === 0) {
    entries.push(info(`${name} 的演出没有可显示的效果`));
  }

  return {
    stage: {
      ...stage,
      characters: stage.characters.map((item) =>
        item.characterUid === character.uid
          ? {
              ...item,
              entered: item.entered || move === '进入',
              expression: expression === '' ? item.expression : expression,
            }
          : item,
      ),
    },
    entries,
  };
}

/* ---------- 跳转目标 ---------- */

type NextTarget =
  | { kind: 'cursor'; cursor: PreviewCursor }
  | { kind: 'end' }
  | { kind: 'missing' };

/** 选项的「下一对话ID」：uid / @continue / @first:<段落uid> */
function resolveNext(
  project: Project,
  option: StoryOption,
  group: Group,
  lineIndex: number,
): NextTarget {
  const value = option.nextId.trim();
  if (value === '') return { kind: 'end' };

  if (isContinueTarget(value)) {
    const nextIndex = lineIndex + 1;
    return nextIndex < group.lines.length
      ? { kind: 'cursor', cursor: { groupUid: group.uid, lineIndex: nextIndex } }
      : { kind: 'end' };
  }

  const firstGroupUid = groupUidOfFirstLine(value);
  if (firstGroupUid !== null) {
    const target = previewGroupOf(project, firstGroupUid);
    if (target === undefined || target.lines.length === 0) return { kind: 'missing' };
    return { kind: 'cursor', cursor: { groupUid: target.uid, lineIndex: 0 } };
  }

  const located = locateLine(project, value);
  return located === undefined
    ? { kind: 'missing' }
    : { kind: 'cursor', cursor: located };
}

/**
 * 按 uid 找行；找不到时再按可读 ID 找一次。
 *
 * 后一次是给手写 / 老数据留的兜底（项目内部存 uid，但导出文本里写的是 ID）。
 */
function locateLine(project: Project, ref: string): PreviewCursor | undefined {
  const value = ref.trim();
  if (value === '') return undefined;

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const index = group.lines.findIndex((line) => line.uid === value);
      if (index >= 0) return { groupUid: group.uid, lineIndex: index };
    }
  }

  const uid = collectRefMaps(project).byId.get(value);
  if (uid === undefined) return undefined;
  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const index = group.lines.findIndex((line) => line.uid === uid);
      if (index >= 0) return { groupUid: group.uid, lineIndex: index };
    }
  }
  return undefined;
}

/** 日志里怎么称呼一个跳转目标：可读 ID */
function describeLineRef(project: Project, cursor: PreviewCursor): string {
  const group = previewGroupOf(project, cursor.groupUid);
  const line = group?.lines[cursor.lineIndex];
  return line === undefined ? '' : `${line.readableId}（${line.text.zh.trim()}）`;
}
