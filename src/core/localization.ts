/**
 * 从剧本里收集本地化条目。
 *
 * 本地化模块和全局搜索都要这份清单，而且要**同一个顺序**——搜索结果里标的
 * 「第几行」就是本地化页面上从上往下数的行号，两边各算一遍迟早会对不上。
 */

import { textIdOf } from './ids';
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
