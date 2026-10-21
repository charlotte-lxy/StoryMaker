/**
 * 「特殊指令」子表。
 *
 * 主指令是「特殊」的指令是程序那边一个一个写的 Blueprint 命令，
 * 它们得单独进一张 DataTable 才能被游戏认出来。这张子表就是把剧情里**实际用到**的
 * 特殊指令收集起来，一行一条（同名只留一行，按第一次出现的顺序排）：
 *
 *   行名      - 参数「特殊指令」的值，如 SP_001
 *   Command类 - 前缀 + `BP_Command_行名.BP_Command_行名_C'`（前缀在导入设置里改）
 *   备注      - 「特殊演出效果」行填的「指令内容」，同名取第一条非空的
 *
 * 收集范围就是对话表「指令」列里属于「指令」行的那些。
 */

import { classPath } from './battle';
import { parseCommandText, SPECIAL_COMMAND_HEAD, SPECIAL_COMMAND_PARAM } from './command-build';
import type { Project } from './types';

export const SPECIAL_COMMAND_SHEET = '特殊指令';

export const SPECIAL_COMMAND_HEADER: readonly string[] = ['', 'Command类', '备注'];

/** 默认的 Command类 前缀：换项目时在「Unreal导入设置」里改这一条即可 */
export const DEFAULT_SPECIAL_COMMAND_CLASS_PREFIX =
  "/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/ComponentBase/Command/SpeciesCommand/";

/** 类名在 Unreal 里长这样：BP_Command_SP_001 */
export function specialCommandClassName(name: string): string {
  return `BP_Command_${name}`;
}

/** 一条指令里的特殊指令名；主指令不是「特殊」、或名字是空的，返回 null */
function specialNameOf(command: string): string | null {
  const parsed = parseCommandText(command);
  if (parsed === null || parsed.head !== SPECIAL_COMMAND_HEAD) return null;
  const named = parsed.params.find((param) => param.name === SPECIAL_COMMAND_PARAM);
  const name = (named?.value ?? parsed.params[0]?.value ?? '').trim();
  return name === '' ? null : name;
}

/** 生成「特殊指令」子表的行（表头 + 数据行） */
export function buildSpecialCommandRows(project: Project): string[][] {
  /** 指令名，按第一次出现的顺序 */
  const names: string[] = [];
  const seen = new Set<string>();
  /** 指令名 → 备注：同名的只取第一条非空的「指令内容」 */
  const notes = new Map<string, string>();

  const collect = (command: string, note: string): void => {
    const name = specialNameOf(command);
    if (name === null) return;
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    if (note !== '' && !notes.has(name)) notes.set(name, note);
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        // 「跳转到段落」行的指令是按段落现拼的，不算特殊指令
        if (line.kind === '指令' && line.jumpGroupUid === null) {
          collect(line.command, line.specialContent ?? '');
        }
      }
    }
  }

  const prefix = project.specialCommandClassPrefix;
  return [
    [...SPECIAL_COMMAND_HEADER],
    ...names.map((name) => {
      const className = specialCommandClassName(name);
      return [name, classPath(prefix, className), notes.get(name) ?? ''];
    }),
  ];
}
