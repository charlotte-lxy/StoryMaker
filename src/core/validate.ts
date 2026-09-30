/**
 * 校验层。
 *
 * 这是本工具相对「直接填 Excel」的核心价值：下面这些错误在表格里全是**静默**的，
 * 要等导入 Unreal 甚至跑起来才炸，而且往往表现为「台词配错人」这种极难定位的现象。
 *
 * 每条问题都带上它属于哪个段落、哪一行，界面点一下就能跳过去。
 */

import { groupUidOfFirstLine, textIdOf } from './ids';
import { collectNameEntries } from './localization';
import { collectRefUids, leadingUid, looksLikeUid } from './refs';
import type { Group, LocalizedText, Project } from './types';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  code: IssueCode;
  /** 出问题的对象可读 ID */
  targetId: string;
  /** 人类可读的位置，如「序章 / 开场」 */
  where: string;
  message: string;
  /** 出问题的那一行；点问题时跳到它 */
  lineUid: string;
  /** 出问题的段落，用于没有具体行的情况（比如没挂上任何行的选项） */
  groupUid: string;
  /**
   * 本地化模块的问题专用：本地化表里那一行的 uid（对话 / 选项用行本身的 uid，
   * UI 文案用条目的 uid）。点这条就切到本地化模块、滚到并高亮这一行。
   */
  localeUid?: string;
  /** 战斗模块的问题专用：切到哪个子页面、哪一行 */
  battlePage?: string;
  battleUid?: string;
}

export type IssueCode =
  | 'empty-id'
  | 'duplicate-id'
  | 'dangling-next'
  | 'next-outside-chapter'
  | 'jump-no-target'
  | 'jump-dangling'
  | 'jump-empty-group'
  | 'dangling-option'
  | 'orphan-option'
  | 'empty-text'
  | 'no-character'
  | 'unknown-character'
  | 'dangling-command-target'
  | 'empty-command'
  | 'empty-option-list'
  | 'missing-translation'
  | 'empty-ui-key'
  | 'duplicate-ui-key'
  /* 战斗模块（GAS） */
  | 'battle-duplicate-name'
  | 'battle-empty-name'
  | 'battle-empty-class'
  | 'battle-not-number'
  | 'battle-empty-modifier'
  | 'battle-unknown-attribute'
  | 'battle-empty-pair'
  | 'battle-duplicate-pair'
  | 'battle-dangling-ref'
  | 'battle-duplicate-id'
  | 'battle-empty-id';

export interface ValidationReport {
  issues: Issue[];
  errors: number;
  warnings: number;
}

/** 选项挂在哪个「选项」行上；没挂上的返回空串 */
function ownerLineUid(group: Group, optionUid: string): string {
  return group.lines.find((line) => line.optionIds.includes(optionUid))?.uid ?? '';
}

export function validateProject(project: Project): ValidationReport {
  const issues: Issue[] = [];

  /**
   * 引用在提示里怎么写给人看。
   *
   * 内部引用存的是 uid，uid 读不出是哪一条，所以干脆不写进提示；
   * 老数据 / 手写的 ID、名字则照原样显示，方便照着改。
   */
  const refText = (raw: string): string => (looksLikeUid(raw) ? '' : `「${raw.trim()}」`);

  /** 项目里所有能当引用目标的 uid（指令目标悬空检查用） */
  const refUids = collectRefUids(project);
  /** 角色表里所有 uid：对话行的角色引用必须落在里面（老数据里按 ID 写的也认） */
  const characterUids = new Set(project.characters.map((row) => row.uid));

  /**
   * 指令 / 条件里指向各表的目标：改动后写进文本的是 uid，
   * 引用的那一行被删掉之后这个 uid 就悬空了（导出会写出一串乱码）。
   * 只报「看起来就是 uid 又找不到」的，老数据里的 ID / 名字照旧不报。
   */
  const checkCommandTarget = (
    text: string,
    where: string,
    targetId: string,
    lineUid: string,
    groupUid: string,
  ): void => {
    const uid = leadingUid(text);
    if (uid === '' || refUids.has(uid)) return;
    issues.push({
      level: 'error',
      code: 'dangling-command-target',
      targetId,
      where,
      message: '指令 / 条件指向的目标已经被删掉了，请在对应表里重新选一次',
      lineUid,
      groupUid,
    });
  };

  /** 每个可读 ID 出现几次，以及第一次出现的位置（报重复 ID 时能点过去） */
  interface Seen {
    count: number;
    where: string;
    groupUid: string;
    lineUid: string;
  }
  const idCounts = new Map<string, Seen>();
  /** 项目里所有行与选项的 uid，用于判断引用是否悬空 */
  const allUids = new Set<string>();
  /** 对话行 uid → 它属于哪一章（判断选项有没有跳到别章） */
  const lineChapter = new Map<string, { uid: string; label: string }>();
  /** 段落 uid → 段落本身，以及它属于哪一章（「跳转到首句」「跳转到段落」要查） */
  const groupByUid = new Map<string, Group>();
  const groupChapter = new Map<string, { uid: string; label: string }>();

  const record = (readableId: string, seen: Omit<Seen, 'count'>): void => {
    const existing = idCounts.get(readableId);
    if (existing === undefined) idCounts.set(readableId, { count: 1, ...seen });
    else existing.count += 1;
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const where = `${chapter.title || chapter.id} / ${group.title || group.id}`;
      groupByUid.set(group.uid, group);
      groupChapter.set(group.uid, { uid: chapter.uid, label: chapter.title || chapter.id });
      for (const line of group.lines) {
        allUids.add(line.uid);
        lineChapter.set(line.uid, { uid: chapter.uid, label: chapter.title || chapter.id });
        record(line.readableId, { where, groupUid: group.uid, lineUid: line.uid });
      }
      for (const option of group.options) {
        allUids.add(option.uid);
        record(option.readableId, {
          where,
          groupUid: group.uid,
          lineUid: ownerLineUid(group, option.uid),
        });
      }
    }
  }

  for (const [id, seen] of idCounts) {
    if (id.trim() === '') {
      issues.push({
        level: 'error',
        code: 'empty-id',
        targetId: '(空)',
        where: seen.where,
        message: '存在没有对话 ID 的行，导入 Unreal 时无法命名',
        lineUid: seen.lineUid,
        groupUid: seen.groupUid,
      });
      continue;
    }
    if (seen.count > 1) {
      issues.push({
        level: 'error',
        code: 'duplicate-id',
        targetId: id,
        where: seen.where,
        message: `对话 ID「${id}」出现了 ${seen.count} 次，导入时会互相覆盖，本地化 key 也会撞车`,
        lineUid: seen.lineUid,
        groupUid: seen.groupUid,
      });
    }
  }

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const where = `${chapter.title || chapter.id} / ${group.title || group.id}`;

      const referencedOptions = new Set<string>();
      for (const line of group.lines) {
        for (const uid of line.optionIds) referencedOptions.add(uid);
      }

      for (const line of group.lines) {
        const at = { lineUid: line.uid, groupUid: group.uid };

        // 「选项」行不自带文本，它的内容都在选项里
        if (line.kind === '选项') {
          if (line.optionIds.length === 0) {
            issues.push({
              level: 'warning',
              code: 'empty-option-list',
              targetId: line.readableId,
              where,
              message: '「选项」行里一个选项都没有，玩家在这里看不到任何分支',
              ...at,
            });
          }
          for (const optionUid of line.optionIds) {
            if (!allUids.has(optionUid)) {
              issues.push({
                level: 'error',
                code: 'dangling-option',
                targetId: line.readableId,
                where,
                message: '引用了不存在的选项',
                ...at,
              });
            }
          }
          continue;
        }

        // 「指令」行只要求填了指令
        if (line.kind === '指令') {
          // 「跳转到段落」行：指令内容由所选段落现拼，这里只看引用还在不在
          if (line.jumpGroupUid !== null) {
            const target = groupByUid.get(line.jumpGroupUid);
            if (line.jumpGroupUid === '') {
              issues.push({
                level: 'warning',
                code: 'jump-no-target',
                targetId: line.readableId,
                where,
                message: '「跳转到段落」还没选要跳到哪个段落，导出后这一行是空的',
                ...at,
              });
            } else if (target === undefined) {
              issues.push({
                level: 'error',
                code: 'jump-dangling',
                targetId: line.readableId,
                where,
                message: '「跳转到段落」指向的段落已经被删掉了',
                ...at,
              });
            } else if (target.lines.length === 0) {
              issues.push({
                level: 'warning',
                code: 'jump-empty-group',
                targetId: line.readableId,
                where,
                message: `「跳转到段落」指向的段落「${target.title || target.id}」里还没有对话，导出后这一行是空的`,
                ...at,
              });
            }
            for (const condition of line.jumpConditions) {
              checkCommandTarget(condition, where, line.readableId, at.lineUid, at.groupUid);
            }
            continue;
          }
          if (line.command.trim() === '') {
            issues.push({
              level: 'warning',
              code: 'empty-command',
              targetId: line.readableId,
              where,
              message: '「指令」行还没填指令，导出后这一行是空的',
              ...at,
            });
          }
          checkCommandTarget(line.command, where, line.readableId, at.lineUid, at.groupUid);
          continue;
        }

        if (line.text.zh.trim() === '') {
          issues.push({
            level: 'warning',
            code: 'empty-text',
            targetId: line.readableId,
            where,
            message: '对话文本为空',
            ...at,
          });
        }

        if (line.characterUid.trim() === '') {
          issues.push({
            level: 'warning',
            code: 'no-character',
            targetId: line.readableId,
            where,
            message: '未指定角色',
            ...at,
          });
        } else {
          // 角色那一格存的是角色 uid；老数据里按角色 ID 写的也认
          const ref = line.characterUid.trim();
          const known =
            characterUids.has(ref) || project.characters.some((row) => row.id.trim() === ref);
          if (!known) {
            // uid 找不到 = 那一行被删了，导出会写出乱码，算必须修复；
            // 老数据 / 手写的角色 ID 找不到只提醒一句：可能角色表还没建全，
            // 而导出照样写这个 ID（跟改之前一样）
            const deleted = looksLikeUid(ref);
            issues.push({
              level: deleted ? 'error' : 'warning',
              code: 'unknown-character',
              targetId: line.readableId,
              where,
              message: deleted
                ? '这一行引用的角色已经被删掉了，请在角色表里重新选一次'
                : `引用的角色${refText(ref)}不在角色表里`,
              ...at,
            });
          }
        }
      }

      for (const option of group.options) {
        const lineUid = ownerLineUid(group, option.uid);

        for (const text of [
          ...option.appearConditions,
          ...option.enableConditions,
          ...option.results,
        ]) {
          checkCommandTarget(text, where, option.readableId, lineUid, group.uid);
        }

        if (!referencedOptions.has(option.uid)) {
          issues.push({
            level: 'warning',
            code: 'orphan-option',
            targetId: option.readableId,
            where,
            message: '这个选项没有挂在任何「选项」行上，玩家永远看不到它',
            lineUid: '',
            groupUid: group.uid,
          });
        }

        const firstLineGroupUid = groupUidOfFirstLine(option.nextId);
        if (firstLineGroupUid !== null) {
          // 「跳转到首句对话」记的是段落：看段落还在不在、里面有没有对话
          const targetGroup = groupByUid.get(firstLineGroupUid);
          const targetChapter = groupChapter.get(firstLineGroupUid);
          if (targetGroup === undefined) {
            issues.push({
              level: 'error',
              code: 'jump-dangling',
              targetId: option.readableId,
              where,
              message: '选项要跳的段落已经被删掉了',
              lineUid,
              groupUid: group.uid,
            });
          } else if (targetGroup.lines.length === 0) {
            issues.push({
              level: 'warning',
              code: 'jump-empty-group',
              targetId: option.readableId,
              where,
              message: `选项要跳的段落「${targetGroup.title || targetGroup.id}」里还没有对话，导出时这一格是空的`,
              lineUid,
              groupUid: group.uid,
            });
          } else if (targetChapter !== undefined && targetChapter.uid !== chapter.uid) {
            issues.push({
              level: 'warning',
              code: 'next-outside-chapter',
              targetId: option.readableId,
              where,
              message: `选项跳到了其他章节「${targetChapter.label}」的段落，跳转目标只能选同一章的段落`,
              lineUid,
              groupUid: group.uid,
            });
          }
        } else if (option.nextId !== '' && !allUids.has(option.nextId)) {
          issues.push({
            level: 'error',
            code: 'dangling-next',
            targetId: option.readableId,
            where,
            message: '选项的跳转目标不存在',
            lineUid,
            groupUid: group.uid,
          });
        } else {
          // 跳转目标只能选同一章的段落：跳到别章的话章节流程图里根本连不上
          const target = lineChapter.get(option.nextId);
          if (target !== undefined && target.uid !== chapter.uid) {
            issues.push({
              level: 'warning',
              code: 'next-outside-chapter',
              targetId: option.readableId,
              where,
              message: `选项跳到了其他章节「${target.label}」的段落，跳转目标只能选同一章的段落`,
              lineUid,
              groupUid: group.uid,
            });
          }
        }
      }
    }
  }

  return {
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
  };
}

/** 本地化表里缺哪几种语言；中文还没写的不算缺译文（那是剧情模块的「空台词」） */
function missingLangs(text: LocalizedText): string[] {
  if (text.zh.trim() === '') return [];
  const missing: string[] = [];
  if (text.en.trim() === '') missing.push('英文');
  if (text.ja.trim() === '') missing.push('日文');
  return missing;
}

/**
 * 本地化模块的校验。
 *
 * 只管译文本身：剧本里收上来的对话 / 选项文本缺英文或日文，
 * 以及 UI 本地化里 key 为空、key 重名、缺英文或日文。
 * 空台词、悬空跳转、ID 重复那些归剧情模块管，这里不重复报。
 */
export function validateLocalization(project: Project): ValidationReport {
  const issues: Issue[] = [];

  const reportMissing = (
    localeUid: string,
    key: string,
    where: string,
    text: LocalizedText,
  ): void => {
    const missing = missingLangs(text);
    if (missing.length === 0) return;
    issues.push({
      level: 'warning',
      code: 'missing-translation',
      targetId: key,
      where,
      message: `缺${missing.join('、')}`,
      lineUid: '',
      groupUid: '',
      localeUid,
    });
  };

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const where = `${chapter.title || chapter.id} / ${group.title || group.id}`;

      for (const line of group.lines) {
        // 本地化表只收「对话」行的文本
        if (line.kind === '对话') {
          reportMissing(line.uid, textIdOf(line.readableId), where, line.text);
        }
      }
      // 选项文本也在本地化表里，包括没挂到任何「选项」行上的
      for (const option of group.options) {
        reportMissing(option.uid, textIdOf(option.readableId), where, option.text);
      }
    }
  }

  const keyCounts = new Map<string, number>();
  for (const row of project.uiTexts) {
    const key = row.key.trim();
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const reportedKey = new Set<string>();
  for (const row of project.uiTexts) {
    const key = row.key.trim();

    if (key === '') {
      issues.push({
        level: 'error',
        code: 'empty-ui-key',
        targetId: '(空)',
        where: 'UI 本地化',
        message: '这条 UI 文案没有 key，导入 Unreal 时无法命名',
        lineUid: '',
        groupUid: '',
        localeUid: row.uid,
      });
    } else if ((keyCounts.get(key) ?? 0) > 1 && !reportedKey.has(key)) {
      // 同一个 key 只报一条，点它跳到第一条上
      reportedKey.add(key);
      issues.push({
        level: 'error',
        code: 'duplicate-ui-key',
        targetId: key,
        where: 'UI 本地化',
        message: `key「${key}」出现了 ${keyCounts.get(key)} 次，导入时会互相覆盖`,
        lineUid: '',
        groupUid: '',
        localeUid: row.uid,
      });
    }

    reportMissing(row.uid, key === '' ? '(空)' : key, 'UI 本地化', row.text);
  }

  // 角色名 / 显示名的译文（中文来自角色表与对话行，英文日文挂在 nameTexts 上）
  for (const entry of collectNameEntries(project)) {
    reportMissing(entry.uid, entry.key, `角色名本地化 · ${entry.groupLabel}`, {
      zh: entry.zh,
      en: entry.en,
      ja: entry.ja,
    });
  }

  return {
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
  };
}
