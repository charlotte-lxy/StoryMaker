import { useEffect, useState } from 'react';

import type { Project } from '../core/types';
import type { BattlePage } from '../state/battle-operations';
import { BattleCharactersPage } from './battle/BattleCharactersPage';
import { BattleEffectsPage } from './battle/BattleEffectsPage';
import { BattleSkillsPage } from './battle/BattleSkillsPage';
import { BattleTagNamePage } from './battle/BattleTagNamePage';
import { BattleTagsPage } from './battle/BattleTagsPage';
import { BattleWeaponsPage } from './battle/BattleWeaponsPage';

/** 子模块按「先建基础表、再看收集结果」的顺序排 */
const PAGES: { key: BattlePage; label: string }[] = [
  { key: 'attributes', label: '属性（AS）' },
  { key: 'events', label: '事件（Event）' },
  { key: 'effects', label: '效果（GE）' },
  { key: 'skills', label: '技能（GA）' },
  { key: 'characters', label: '角色预设' },
  { key: 'weapons', label: '武器' },
  { key: 'tags', label: 'GameplayTags管理器' },
];

interface Props {
  project: Project;
  onChange: (next: Project) => void;
  /** 底部校验条里点过来的那一条：切到它所在的子页面、滚到并闪一下那一行 */
  focusPage?: BattlePage | null;
  focusUid?: string | null;
}

/**
 * 战斗模块（GAS）。
 *
 * 左边一条窄栏切换七个子模块，内容区各自是一张表，底部那条校验结果由上层统一放。
 * 各种 Tag 都由名字合成，所以这里看不到手填 Tag 的地方——只在管理器里看结果。
 */
export function BattleEditor({ project, onChange, focusPage = null, focusUid = null }: Props) {
  const [page, setPage] = useState<BattlePage>('attributes');

  // 校验条里点过来的那一条：先切页，再滚到那一行
  useEffect(() => {
    if (focusPage !== null) setPage(focusPage);
  }, [focusPage]);

  useEffect(() => {
    if (focusUid === null) return;
    for (const node of document.querySelectorAll<HTMLElement>('[data-battle-uid]')) {
      if (node.dataset.battleUid !== focusUid) continue;
      node.scrollIntoView({ block: 'center' });
      // 六张表的行分散在各个子页面里，高亮就直接加在那一行上，
      // 省得为了一闪而过再往每个页面里传一遍 focusUid
      node.classList.add('flash');
      const timer = window.setTimeout(() => node.classList.remove('flash'), 1800);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [focusUid, page]);

  const pageProps = { project, onChange };

  return (
    <div className="battle-body">
      <aside className="battle-side">
        {PAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={page === item.key ? 'battle-nav active' : 'battle-nav'}
            onClick={() => setPage(item.key)}
          >
            {item.label}
            {item.key !== 'tags' && <span className="count">{project.battle[item.key].length}</span>}
          </button>
        ))}
      </aside>

      <div className="battle-main">
        {page === 'attributes' && (
          <BattleTagNamePage
            {...pageProps}
            tableKey="attributes"
            title="属性表（AS）"
            hint="属性名不能重复，合成 Tag 的格式是「GAS.属性.属性名」。"
            nameLabel="属性名"
            addLabel="＋ 新增属性"
          />
        )}
        {page === 'events' && (
          <BattleTagNamePage
            {...pageProps}
            tableKey="events"
            title="事件表（Event）"
            hint="事件名不能重复，合成 Tag 的格式是「GAS.事件.事件名」。"
            nameLabel="事件名"
            addLabel="＋ 新增事件"
          />
        )}
        {page === 'effects' && <BattleEffectsPage {...pageProps} />}
        {page === 'skills' && <BattleSkillsPage {...pageProps} />}
        {page === 'characters' && <BattleCharactersPage {...pageProps} />}
        {page === 'weapons' && <BattleWeaponsPage {...pageProps} />}
        {page === 'tags' && <BattleTagsPage {...pageProps} />}
      </div>
    </div>
  );
}
