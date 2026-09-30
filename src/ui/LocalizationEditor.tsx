import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { collectLocaleEntries, collectNameEntries } from '../core/localization';
import type { LangKey, LocalizedText, Project, UiTextRow } from '../core/types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { useRememberedChoice, useScrollMemory } from './view-memory';

interface Props {
  project: Project;
  /** 改对话 / 选项的三语文本 */
  onUpdateText: (uid: string, lang: LangKey, value: string) => void;
  /** 新增一条 UI 文案，key 由界面保证非空且不与已有条目重名 */
  onAddUiText: (key: string, text: LocalizedText) => void;
  onRemoveUiText: (uid: string) => void;
  onUpdateUiText: (uid: string, patch: Partial<UiTextRow>) => void;
  /**
   * 改「角色名本地化」里的一条。中文与英文日文都挂在角色表那一行 / 别名上。
   */
  onUpdateNameText: (uid: string, lang: LangKey, value: string) => void;
  /**
   * 底下校验条里点过来的那一行：切到它所在的页、滚到它并闪一下。
   * 短暂高亮后由上层清成 null。
   */
  focusUid?: string | null;
}

const LANGS: { lang: LangKey; label: string }[] = [
  { lang: 'zh', label: '中文' },
  { lang: 'en', label: '英文' },
  { lang: 'ja', label: '日文' },
];

/** 本地化模块的三个页面 */
type LocalePage = 'story' | 'ui' | 'name';

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
 * 分三页，左侧窄栏切换，窄栏下方是搜索框，搜的是当前这一页：
 *   剧情本地化   - 从剧本里自动收集的对话与选项文本，不能增删条目，只能改译文
 *   UI 本地化    - 程序给的界面文案（TXT_Widget_* 这类），条目自己增删改
 *   角色名本地化 - 角色表的「显示名称」：默认名称与各别名，key 自动生成
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
  onUpdateNameText,
  focusUid = null,
}: Props) {
  const [page, setPage] = useRememberedChoice<LocalePage>('locale:page', 'story');
  const [query, setQuery] = useState('');
  /** 新增表单：填好 key 与译文，点「添加」插到列表最前面 */
  const [draft, setDraft] = useState<UiDraft>(EMPTY_DRAFT);
  const editorRef = useScrollMemory('locale');

  const entries = useMemo(() => collectLocaleEntries(project), [project]);
  /** 角色名 / 别名：中文与译文都挂在角色表那一行上 */
  const nameEntries = useMemo(() => collectNameEntries(project), [project]);

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
  const shownNameEntries = useMemo(
    () =>
      trimmed === ''
        ? nameEntries
        : nameEntries.filter((entry) => hit([entry.key, entry.zh, entry.en, entry.ja], trimmed)),
    [nameEntries, trimmed],
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

  /** 角色名与别名的中文、译文都在角色表那一行上，这里只看英文日文缺没缺 */
  const nameUntranslated = useMemo(
    () =>
      nameEntries.filter((entry) =>
        missingTranslation({ zh: entry.zh, en: entry.en, ja: entry.ja }),
      ).length,
    [nameEntries],
  );

  /** UI 本地化的 key 重复提示：同一个 key 在 Unreal 里会互相覆盖 */
  const keyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of uiTexts) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
    return counts;
  }, [uiTexts]);

  const shown =
    page === 'story'
      ? shownEntries.length
      : page === 'ui'
        ? shownUiTexts.length
        : shownNameEntries.length;
  const total =
    page === 'story' ? entries.length : page === 'ui' ? uiTexts.length : nameEntries.length;

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

  // 底下校验条点过来的那一行：先切到它所在的页，并把搜索框清掉，
  // 免得那一行正好被搜索藏起来、跳过去看不见
  useEffect(() => {
    if (focusUid === null) return;
    setQuery('');
    if (entries.some((entry) => entry.uid === focusUid)) setPage('story');
    else if (nameEntries.some((entry) => entry.uid === focusUid)) setPage('name');
    else setPage('ui');
    // 这几份清单只在选页时用一下，值变了不必重跑（否则会清掉用户刚输入的搜索词）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUid]);

  // 那一行渲染出来之后再滚过去；页面切换、列表内容变化后也重新找一次
  useEffect(() => {
    if (focusUid === null) return;
    for (const node of document.querySelectorAll<HTMLElement>('[data-text-uid]')) {
      if (node.dataset.textUid !== focusUid) continue;
      node.scrollIntoView({ block: 'center' });
      return;
    }
  }, [focusUid, page, shownEntries, shownUiTexts, shownNameEntries]);

  return (
    <div className="editor" ref={editorRef}>
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
          ) : page === 'ui' ? (
            <>
              共 {uiTexts.length} 条 UI 文本：
              {uiUntranslated > 0 ? (
                <strong className="warn-text">{uiUntranslated} 条缺英文或日文</strong>
              ) : (
                '英文日文均已填写'
              )}
            </>
          ) : (
            <>
              共 {nameEntries.length} 条角色名 / 别名：都在角色表的「显示名称」里
              （默认名称与各别名，在这一页改会写回角色表），
              {nameUntranslated > 0 ? (
                <strong className="warn-text">{nameUntranslated} 条缺英文或日文</strong>
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
          <button
            type="button"
            className={page === 'name' ? 'locale-nav active' : 'locale-nav'}
            onClick={() => setPage('name')}
            title="角色表「显示名称」里的默认名称与各别名，key 自动生成"
          >
            角色名本地化
            <span className="count">{nameEntries.length}</span>
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
                          className={`line-row${missingTranslation(entry.text) ? ' needs-work' : ''}${
                            focusUid === entry.uid ? ' flash' : ''
                          }`}
                          data-text-uid={entry.uid}
                        >
                          <td className="cell-id loc-key">
                            {entry.key}
                            <span className="kind-chip">{entry.kindLabel}</span>
                          </td>
                          {LANGS.map((item) => (
                            <td key={item.lang}>
                              <AutoGrowTextarea
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
          ) : page === 'ui' ? (
            <>
              {/* 新增表单放在整个列表上方：填好 key 与译文，点「添加」插到列表最前面 */}
              <div className="locale-add-form">
                <label className="locale-add-field locale-add-key">
                  <span className="line-field-name">文本 key（必填）</span>
                  <input
                    className={duplicated === undefined ? '' : 'duplicate'}
                    value={draft.key}
                    placeholder="TXT_（必填，不能重名）"
                    onChange={(event) => setDraft((prev) => ({ ...prev, key: event.target.value }))}
                    onKeyDown={submitOnEnter}
                  />
                  {duplicated !== undefined && (
                    <div className="field-error">key 已存在：{duplicated.key}</div>
                  )}
                </label>

                {LANGS.map((item) => (
                  <label className="locale-add-field" key={item.lang}>
                    <span className="line-field-name">{item.label}</span>
                    <input
                      value={draft[item.lang]}
                      placeholder={item.lang === 'zh' ? '中文原文' : '待翻译'}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [item.lang]: event.target.value }))
                      }
                      onKeyDown={submitOnEnter}
                    />
                  </label>
                ))}

                <div className="locale-add-field locale-add-submit">
                  <span className="line-field-name">操作</span>
                  <button type="button" className="primary" disabled={!canAdd} onClick={submitUiText}>
                    添加
                  </button>
                </div>
              </div>

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
                  {shownUiTexts.map((row) => (
                    <tr
                      className={`line-row${missingTranslation(row.text) ? ' needs-work' : ''}${
                        focusUid === row.uid ? ' flash' : ''
                      }`}
                      data-text-uid={row.uid}
                      key={row.uid}
                    >
                      <td className="loc-key">
                        <input
                          value={row.key}
                          placeholder="TXT_"
                          onChange={(event) => onUpdateUiText(row.uid, { key: event.target.value })}
                        />
                        {(keyCounts.get(row.key) ?? 0) > 1 && (
                          <div className="field-error">key 重复</div>
                        )}
                      </td>
                      {LANGS.map((item) => (
                        <td key={item.lang}>
                          <AutoGrowTextarea
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
                          ? '还没有 UI 文本。在上面那个表单里填好 key 与译文，点「添加」就会插到列表最前面。'
                          : `没有匹配「${query.trim()}」的 UI 文本。`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          ) : nameEntries.length === 0 ? (
            <div className="empty-state">
              还没有角色名或别名。先去「角色」模块建角色、给他的「显示名称」添几个别名。
            </div>
          ) : shownNameEntries.length === 0 ? (
            <div className="empty-state">没有匹配「{query.trim()}」的角色名或别名。</div>
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
                {shownNameEntries.map((entry, index) => {
                  const text: LocalizedText = { zh: entry.zh, en: entry.en, ja: entry.ja };
                  const showHeading =
                    index === 0 || shownNameEntries[index - 1].groupLabel !== entry.groupLabel;
                  return (
                    <Fragment key={entry.uid}>
                      {showHeading && (
                        <tr className="group-heading">
                          <td colSpan={4}>{entry.groupLabel}</td>
                        </tr>
                      )}
                      <tr
                        className={`line-row${missingTranslation(text) ? ' needs-work' : ''}${
                          focusUid === entry.uid ? ' flash' : ''
                        }`}
                        data-text-uid={entry.uid}
                      >
                        <td className="cell-id loc-key">
                          {entry.key}
                          <span className="kind-chip">{entry.kindLabel}</span>
                        </td>
                        {LANGS.map((item) => (
                          <td key={item.lang}>
                            <AutoGrowTextarea
                              value={text[item.lang]}
                              placeholder={item.lang === 'zh' ? '中文原文' : '待翻译'}
                              title={
                                item.lang === 'zh'
                                  ? '中文改的是角色表「显示名称」里的默认名称 / 别名文字'
                                  : undefined
                              }
                              onChange={(event) =>
                                onUpdateNameText(entry.uid, item.lang, event.target.value)
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
          )}
        </div>
      </div>
    </div>
  );
}