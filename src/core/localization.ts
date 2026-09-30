/**
 * 从剧本里收集本地化条目。
 *
 * 本地化模块和全局搜索都要这份清单，而且要**同一个顺序**——搜索结果里标的
 * 「第几行」就是本地化页面上从上往下数的行号，两边各算一遍迟早会对不上。
 */

import { characterNameKeyOf, displayNameKeyOf, textIdOf } from './ids';
import type { LocalizedText, Project } from './types';

export interface LocaleEntry {
  /** 挂在哪条对话 / 选项上 */
  uid: string;
  /** 本地化 key，如 TXT_Dia_ch01_001-1 */
  key: string;
  /** 是对白还是选项（未挂载的选项单独标出来，免得漏翻） */
  kindLabel: string;
  text: LocalizedText;
  /** 「章节 / 段落」，列表里按它分段 */
  groupLabel: string;
}

/** 按剧本顺序收集对白与选项的本地化条目 */
export function collectLocaleEntries(project: Project): LocaleEntry[] {
  const list: LocaleEntry[] = [];
  const seen = new Set<string>();

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      const groupLabel = `${chapter.title || chapter.id} / ${group.title || group.id}`;

      for (const line of group.lines) {
        // 只有「对话」行有文本，「指令」行与「选项」行本身不进本地化表
        if (line.kind === '对话') {
          list.push({
            uid: line.uid,
            key: textIdOf(line.readableId),
            kindLabel: '对话',
            text: line.text,
            groupLabel,
          });
          seen.add(line.uid);
        }

        for (const optionUid of line.optionIds) {
          const option = group.options.find((o) => o.uid === optionUid);
          if (option === undefined) continue;
          list.push({
            uid: option.uid,
            key: textIdOf(option.readableId),
            kindLabel: '选项',
            text: option.text,
            groupLabel,
          });
          seen.add(option.uid);
        }
      }

      // 没有被任何「选项」行引用的选项也要列出来，否则会漏翻
      for (const option of group.options) {
        if (seen.has(option.uid)) continue;
        list.push({
          uid: option.uid,
          key: textIdOf(option.readableId),
          kindLabel: '选项（未挂载）',
          text: option.text,
          groupLabel,
        });
        seen.add(option.uid);
      }
    }
  }

  return list;
}

/**
 * 「角色名本地化」页的一条：角色的默认名称，或对话行的显示名。
 *
 * 中文在角色表 / 对话行上，英文日文在 project.nameTexts 里（按 uid 挂回来）。
 * 页面上从上往下数的行号就是这个数组的顺序，全局搜索也按它算。
 */
export interface NameEntry {
  /** 角色表那一行的 uid，或对话行的 uid */
  uid: string;
  /** TXT_<角色ID>_DefaultName 或 TXT_<对话ID>_DisplayName */
  key: string;
  /** 是角色名还是显示名 */
  kindLabel: '角色名' | '显示名';
  zh: string;
  en: string;
  ja: string;
  /** 在哪儿填的，列表里按它分段 */
  groupLabel: string;
}

/**
 * 收集角色名与显示名的本地化条目。
 *
 * 顺序：先角色表（按表里的顺序），再剧本里有填显示名的对话行（按剧本顺序）。
 * 角色 ID 空着的行拼不出 key，跳过（角色表里会就地提示）。
 */
export function collectNameEntries(project: Project): NameEntry[] {
  const texts = new Map(project.nameTexts.map((row) => [row.uid, row]));
  const list: NameEntry[] = [];

  for (const character of project.characters) {
    const id = character.id.trim();
    if (id === '') continue;
    const text = texts.get(character.uid);
    list.push({
      uid: character.uid,
      key: characterNameKeyOf(id),
      kindLabel: '角色名',
      zh: character.name,
      en: text?.en ?? '',
      ja: text?.ja ?? '',
      groupLabel: '角色表',
    });
  }

  for (const chapter of project.chapters) {
    for (const group of chapter.groups) {
      for (const line of group.lines) {
        // 只收「填了显示名」的行：没填的导出那一格本来就是空的
        if (line.displayName.trim() === '') continue;
        const text = texts.get(line.uid);
        list.push({
          uid: line.uid,
          key: displayNameKeyOf(line.readableId),
          kindLabel: '显示名',
          zh: line.displayName,
          en: text?.en ?? '',
          ja: text?.ja ?? '',
          groupLabel: `${chapter.title || chapter.id} / ${group.title || group.id}`,
        });
      }
    }
  }

  return list;
}
