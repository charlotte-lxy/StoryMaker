import { useMemo, useState } from 'react';

import type { Project } from '../core/types';
import {
  SEARCH_MODULES,
  searchProject,
  type SearchModuleKey,
  type SearchTarget,
} from '../state/search';

interface Props {
  project: Project;
  /** 点某一条结果：由上层负责切模块、滚到并高亮那一行 */
  onJump: (target: SearchTarget) => void;
}

/**
 * 标题栏正中的全局搜索。
 *
 * 点一下输入框展开下拉页：最上面一排是模块筛选（「全部」在最左边，一次只选中一个），
 * 下面按模块分两层列结果——第一层是模块，第二层是这个模块里的模糊命中，
 * 每条左边标着「子模块 · 第几行 · 行标识」，点一条直接跳过去。
 *
 * 面板与遮罩都挂在 toolbar 上（不是挂在输入框那个盒子里）：输入框在窄窗口下会
 * 退回成普通的一行，挂在自己身上会让面板跟着一起动。
 */
export function GlobalSearch({ project, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** 当前选中的模块筛选；null = 全部 */
  const [only, setOnly] = useState<SearchModuleKey | null>(null);

  const keyword = query.trim();
  const groups = useMemo(
    () => (open ? searchProject(project, query, only) : []),
    [open, project, query, only],
  );
  const total = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <>
      <div className="toolbar-search">
        <input
          className="search-input"
          value={query}
          placeholder="全局搜索：对话、角色、数据表、GAS、本地化…"
          title="点这里展开搜索页；输入关键词后按模块分组列出结果，点一条直接跳过去"
          onFocus={() => setOpen(true)}
          // 点一下也要展开：点空白处只是收起面板，输入框还留着焦点，
          // 光靠 onFocus 再点它不会重新触发
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        />
      </div>

      {open && (
        <>
          <div className="search-mask" onClick={() => setOpen(false)} />

          <div className="search-panel">
            <div className="search-filters">
              <button
                type="button"
                className={only === null ? 'search-filter active' : 'search-filter'}
                title="所有模块一起搜"
                onClick={() => setOnly(null)}
              >
                全部
              </button>
              {SEARCH_MODULES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={only === item.key ? 'search-filter active' : 'search-filter'}
                  title={`只在「${item.label}」里搜`}
                  onClick={() => setOnly(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="search-results">
              {keyword === '' ? (
                <div className="search-empty">
                  输入关键词开始搜索：对话文本、章节段落名、角色、物品、任务、立绘、音效、
                  条件与指令、GAS 各表、本地化都能搜。
                </div>
              ) : total === 0 ? (
                <div className="search-empty">没有匹配「{keyword}」的条目。</div>
              ) : (
                groups.map((group) => (
                  <div className="search-group" key={group.module}>
                    <div className="search-group-head">
                      <span>{group.label}</span>
                      <span className="search-group-count">
                        {group.total} 条
                        {group.total > group.hits.length
                          ? `（只列前 ${group.hits.length} 条，请输入更精确的关键词）`
                          : ''}
                      </span>
                    </div>

                    {group.hits.map((hit) => (
                      <button
                        type="button"
                        className="search-hit"
                        key={`${hit.target.kind}:${hit.target.uid}`}
                        title="点一下跳到这一条"
                        onClick={() => {
                          setOpen(false);
                          onJump(hit.target);
                        }}
                      >
                        <span className="search-hit-where">
                          {hit.submodule} · 第 {hit.rowNumber} 行 · {hit.rowLabel}
                        </span>
                        {hit.text === '' ? null : (
                          <span className="search-hit-text">{hit.text}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
