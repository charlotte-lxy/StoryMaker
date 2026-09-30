/**
 * 从剧本里收集本地化条目。
 *
 * 本地化模块和全局搜索都要这份清单，而且要**同一个顺序**——搜索结果里标的
 * 「第几行」就是本地化页面上从上往下数的行号，两边各算一遍迟早会对不上。
 */

import { aliasNameKeyOf, characterNameKeyOf, textIdOf } from './ids';
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
 * 「角色名本地化」页的一条：一个角色的默认名称，或它的某个别名。
 *
 * 中文与译文都在角色表那一行上（默认名称：name / nameEn / nameJa；别名：text / en / ja）。
 * 页面上从上往下数的行号就是这个数组的顺序，全局搜索也按它算。
 */
export interface NameEntry {
  /** 角色表那一行的 uid，或别名自己的 uid */
  uid: string;
  /** TXT_<角色ID>_DefaultName 或 TXT_<角色ID>_OtherName-<别名序号> */
  key: string;
  /** 「默认名称」或「别名1」「别名2」… */
  kindLabel: string;
  zh: string;
  en: string;
  ja: string;
  /** 属于哪个角色，列表里按它分段 */
  groupLabel: string;
}

/**
 * 收集角色名与别名的本地化条目（顺序：角色表顺序，每个角色先默认名称、再各别名）。
 *
 * 对话行里的「显示名」不在这里——它只是从角色表的名称 / 别名里选一个，
 * 文本本身只有角色表那一份。角色 ID 空着的行拼不出 key，跳过（角色表里会就地提示）。
 */
export function collectNameEntries(project: Project): NameEntry[] {
  const list: NameEntry[] = [];

  for (const character of project.characters) {
    const id = character.id.trim();
    if (id === '') continue;
    const groupLabel = `${id}（${character.name.trim() === '' ? '未命名' : character.name.trim()}）`;

    list.push({
      uid: character.uid,
      key: characterNameKeyOf(id),
      kindLabel: '默认名称',
      zh: character.name,
      en: character.nameEn,
      ja: character.nameJa,
      groupLabel,
    });

    character.aliases.forEach((alias, index) => {
      list.push({
        uid: alias.uid,
        key: aliasNameKeyOf(id, index),
        kindLabel: `别名${index + 1}`,
        zh: alias.text,
        en: alias.en,
        ja: alias.ja,
        groupLabel,
      });
    });
  }

  return list;
}
