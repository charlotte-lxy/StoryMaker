import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';

import { textIdOf } from '../core/ids';
import type { LangKey, LocalizedText, Project, UiTextRow } from '../core/types';

interface Props {
  project: Project;
  /** 改对话 / 选项的三语文本 */
  onUpdateText: (uid: string, lang: LangKey, value: string) => void;
  /** 新增一条 UI 文案，key 由界面保证非空且不与已有条目重名 */
  onAddUiText: (key: string, text: LocalizedText) => void;
  onRemoveUiText: (uid: string) => void;
  onUpdateUiText: (uid: string, patch: Partial<UiTextRow>) => void;
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

/** 本地化模块的两个页面 */
type LocalePage = 'story' | 'ui';

/** UI 本地化最上面那一行新增表单的草稿 */
interface UiDraft extends LocalizedText {
  key: string;
}

const EMPTY_DRAFT: UiDraft = { key: '', zh: '', en: '', ja: '' };

/** 模糊搜索：忽略大小写，命中 key 或三语文本里的任意一处就算 */
function hit(fields: string[], query: string): boolean {
  return fields.some((field) => field.toLowerCase().includes(query));
}

/** 有中文、但英文或日文还空着 */
function missingTranslation(text: LocalizedText): boolean {
  return text.zh.trim() !== '' && (text.en.trim() === '' || text.ja.trim() === '');
}

/**
 * 本地化模块。
 *
 * 分两页，左侧窄栏切换，窄栏下方是搜索框，搜的是当前这一页：
 *   剧情本地化 - 从剧本里自动收集的对话与选项文本，不能增删条目，只能改译文
 *   UI 本地化   - 程序给的界面文案（TXT_Widget_* 这类），条目自己增删改
 *
 * 剧情这一页不需要任何"重排后同步"的逻辑：文本挂在 uid 上，
 * 拖拽排序只改变可读 ID，因此 TXT_xxx 这个 key 会自动跟着新编号走，
 * 内容不会与台词错位。这正是当初把 uid 和可读 ID 分开的原因。
 */
export function LocalizationEditor({
  project,
  onUpdateText,
  onAddUiText,
  onRemoveUiText,
  onUpdateUiText,
}: Props) {
  const [page, setPage] = useState<LocalePage>('story');
  const [query, setQuery] = useState('');
  /** 新增表单：填好 key 与译文，点「添加」插到列表最前面 */
  const [draft, setDraft] = useState<UiDraft>(EMPTY_DRAFT);

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

  const uiTexts = project.uiTexts;

  const trimmed = query.trim().toLowerCase();
  const shownEntries = useMemo(
    () =>
      trimmed === ''
        ? entries
        : entries.filter((entry) => hit([entry.key, entry.text.zh, entry.text.en, entry.text.ja], trimmed)),
    [entries, trimmed],
  );
  const shownUiTexts = useMemo(
    () =>
      trimmed === ''
        ? uiTexts
        : uiTexts.filter((row) => hit([row.key, row.text.zh, row.text.en, row.text.ja], trimmed)),
    [uiTexts, trimmed],
  );

  const stats = useMemo(() => {
    let withText = 0;
    let untranslated = 0;
    for (const entry of entries) {
      if (entry.text.zh.trim() !== '') withText += 1;
      if (missingTranslation(entry.text)) untranslated += 1;
    }
    return { total: entries.length, withText, untranslated };
  }, [entries]);

  const uiUntranslated = useMemo(
    () => uiTexts.filter((row) => missingTranslation(row.text)).length,
    [uiTexts],
  );

  /** UI 本地化的 key 重复提示：同一个 key 在 Unreal 里会互相覆盖 */
  const keyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of uiTexts) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
    return counts;
  }, [uiTexts]);

  const shown = page === 'story' ? shownEntries.length : shownUiTexts.length;
  const total = page === 'story' ? entries.length : uiTexts.length;

  /** 表单里的 key 有没有和已有条目重名（去掉首尾空格后比） */
  const draftKey = draft.key.trim();
  const duplicated = draftKey === '' ? undefined : uiTexts.find((row) => row.key.trim() === draftKey);
  const canAdd = draftKey !== '' && duplicated === undefined;

  const submitUiText = (): void => {
    if (!canAdd) return;
    onAddUiText(draftKey, { zh: draft.zh, en: draft.en, ja: draft.ja });
    setDraft(EMPTY_DRAFT);
  };

  /** 表单里按回车等同于点「添加」，连着填几条时不用来回换手 */
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitUiText();
    }
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>本地化</h2>
        <span className="hint">
          {page === 'story' ? (
            <>
              共 {stats.total} 条文本：{stats.withText} 条有中文，
              {stats.untranslated > 0 ? (
                <strong className="warn-text">{stats.untranslated} 条缺英文或日文</strong>
              ) : (
                '英文日文均已填写'
              )}
            </>
          ) : (
            <>
              共 {uiTexts.length} 条 UI 文本：
              {uiUntranslated > 0 ? (
                <strong className="warn-text">{uiUntranslated} 条缺英文或日文</strong>
              ) : (
                '英文日文均已填写'
              )}
            </>
          )}
        </span>
      </div>

      <div className="locale-body">
        <aside className="locale-side">
          <button
            type="button"
            className={page === 'story' ? 'locale-nav active' : 'locale-nav'}
            onClick={() => setPage('story')}
          >
            剧情本地化
            <span className="count">{entries.length}</span>
          </button>
          <button
            type="button"
            className={page === 'ui' ? 'locale-nav active' : 'locale-nav'}
            onClick={() => setPage('ui')}
          >
            UI 本地化
            <span className="count">{uiTexts.length}</span>
          </button>

          <input
            className="locale-search"
            value={query}
            placeholder="搜索 key 或文本"
            title="在当前这一页里模糊搜索：key 和中文 / 英文 / 日文都会匹配"
            onChange={(event) => setQuery(event.target.value)}
          />
          {trimmed !== '' && (
            <span className="locale-hit">
              命中 {shown} / {total} 条
            </span>
          )}
        </aside>

        <div className="locale-main">
          {page === 'story' ? (
            entries.length === 0 ? (
              <div className="empty-state">还没有任何文本。先去「剧情」模块写点对话吧。</div>
            ) : shownEntries.length === 0 ? (
              <div className="empty-state">没有匹配「{query.trim()}」的对话或选项文本。</div>
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
                  {shownEntries.map((entry, index) => {
                    const showHeading =
                      index === 0 || shownEntries[index - 1].groupLabel !== entry.groupLabel;
                    return (
                      <Fragment key={entry.uid}>
                        {showHeading && (
                          <tr className="group-heading">
                            <td colSpan={4}>{entry.groupLabel}</td>
                          </tr>
                        )}
                        <tr
                          className={`line-row${missingTranslation(entry.text) ? ' needs-work' : ''}`}
                        >
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
                                onChange={(event) =>
                                  onUpdateText(entry.uid, item.lang, event.target.value)
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : (
            <table className="lines">
              <thead>
                <tr>
                  <th className="col-key">文本 key</th>
                  {LANGS.map((item) => (
                    <th key={item.lang}>{item.label}</th>
                  ))}
                  <th style={{ width: 74 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {/* 新增表单就占列表的第一行，填好 key 与译文点「添加」插到最前面 */}
                <tr className="locale-add-row">
                  <td>
                    <input
                      value={draft.key}
                      placeholder="TXT_（必填，不能重名）"
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, key: event.target.value }))
                      }
                      onKeyDown={submitOnEnter}
                    />
                    {duplicated !== undefined && (
                      <div className="field-error">key 已存在：{duplicated.key}</div>
                    )}
                  </td>
                  {LANGS.map((item) => (
                    <td key={item.lang}>
                      <input
                        value={draft[item.lang]}
                        placeholder={item.lang === 'zh' ? '中文原文' : '待翻译'}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, [item.lang]: event.target.value }))
                        }
                        onKeyDown={submitOnEnter}
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="primary" disabled={!canAdd} onClick={submitUiText}>
                      添加
                    </button>
                  </td>
                </tr>

                {shownUiTexts.map((row) => (
                  <tr
                    className={`line-row${missingTranslation(row.text) ? ' needs-work' : ''}`}
                    key={row.uid}
                  >
                    <td className="loc-key">
                      <input
                        value={row.key}
                        placeholder="TXT_"
                        onChange={(event) => onUpdateUiText(row.uid, { key: event.target.value })}
                      />
                      {(keyCounts.get(row.key) ?? 0) > 1 && <div className="field-error">key 重复</div>}
                    </td>
                    {LANGS.map((item) => (
                      <td key={item.lang}>
                        <textarea
                          rows={2}
                          value={row.text[item.lang]}
                          placeholder={item.lang === 'zh' ? '中文原文' : '待翻译'}
                          onChange={(event) =>
                            onUpdateUiText(row.uid, {
                              text: { ...row.text, [item.lang]: event.target.value },
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button type="button" onClick={() => onRemoveUiText(row.uid)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}

                {shownUiTexts.length === 0 && (
                  <tr className="locale-form-note">
                    <td colSpan={5}>
                      {uiTexts.length === 0
                        ? '还没有 UI 文本。在上面这一行填好 key 与译文，点「添加」就会插到列表最前面。'
                        : `没有匹配「${query.trim()}」的 UI 文本。`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
