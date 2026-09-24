import { Fragment, useMemo } from 'react';

import { textIdOf } from '../core/ids';
import type { LangKey, LocalizedText, Project } from '../core/types';

interface Props {
  project: Project;
  onUpdateText: (uid: string, lang: LangKey, value: string) => void;
}

interface LocEntry {
  uid: string;
  key: string;
  kindLabel: string;
  text: LocalizedText;
  groupLabel: string;
}

const LANGS: { lang: LangKey; label: string }[] = [
  { lang: 'zh', label: '中文' },
  { lang: 'en', label: '英文' },
  { lang: 'ja', label: '日文' },
];

/**
 * 本地化模块。
 *
 * 这一页不需要任何"重排后同步"的逻辑：文本挂在 uid 上，
 * 拖拽排序只改变可读 ID，因此 TXT_xxx 这个 key 会自动跟着新编号走，
 * 内容不会与台词错位。这正是当初把 uid 和可读 ID 分开的原因。
 */
export function LocalizationEditor({ project, onUpdateText }: Props) {
  const entries = useMemo(() => {
    const list: LocEntry[] = [];
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
  }, [project]);

  const stats = useMemo(() => {
    let withText = 0;
    let untranslated = 0;
    for (const entry of entries) {
      if (entry.text.zh.trim() !== '') withText += 1;
      if (entry.text.zh.trim() !== '' && (entry.text.en.trim() === '' || entry.text.ja.trim() === '')) {
        untranslated += 1;
      }
    }
    return { total: entries.length, withText, untranslated };
  }, [entries]);

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>本地化</h2>
        <span className="hint">
          共 {stats.total} 条文本：{stats.withText} 条有中文，
          {stats.untranslated > 0 ? (
            <strong className="warn-text">{stats.untranslated} 条缺英文或日文</strong>
          ) : (
            '英文日文均已填写'
          )}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">还没有任何文本。先去「剧情」模块写点对话吧。</div>
      ) : (
        <table className="lines">
          <thead>
            <tr>
              <th className="col-key">文本 key</th>
              {LANGS.map((item) => (
                <th key={item.lang}>{item.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => {
              const showHeading = index === 0 || entries[index - 1].groupLabel !== entry.groupLabel;
              const missing =
                entry.text.zh.trim() !== '' &&
                (entry.text.en.trim() === '' || entry.text.ja.trim() === '');
              return (
                <Fragment key={entry.uid}>
                  {showHeading && (
                    <tr className="group-heading">
                      <td colSpan={4}>{entry.groupLabel}</td>
                    </tr>
                  )}
                  <tr className={`line-row${missing ? ' needs-work' : ''}`}>
                    <td className="cell-id loc-key">
                      {entry.key}
                      <span className="kind-chip">{entry.kindLabel}</span>
                    </td>
                    {LANGS.map((item) => (
                      <td key={item.lang}>
                        <textarea
                          rows={2}
                          value={entry.text[item.lang]}
                          placeholder={item.lang === 'zh' ? '中文原文' : '待翻译'}
                          onChange={(event) => onUpdateText(entry.uid, item.lang, event.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
