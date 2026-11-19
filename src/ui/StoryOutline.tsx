/**
 * 剧情模块左侧的合并面板：上面一排页签，「章节 / 段落」和「流程图」二选一。
 *
 * 原来它们是并排的两栏（树 + 流程图），合并后能腾出地方给右侧的对话列表和预览，
 * 代价是同一时刻只看得到一个——所以流量图的宽度要靠下面的分隔线自己拉。
 *
 * 宽度记在本机（storymaker.story-layout.v1），不跟项目文件走。
 */

import { useCallback, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { clampOutlineWidth } from '../state/prefs';
import { useRememberedChoice } from './view-memory';

type OutlineTab = 'tree' | 'flow';

interface Props {
  width: number;
  onResize: (width: number) => void;
  /** 「章节 / 段落」页签的内容 */
  tree: ReactNode;
  /** 「流程图」页签的内容 */
  flow: ReactNode;
}

export function StoryOutline({ width, onResize, tree, flow }: Props) {
  const [tab, chooseTab] = useRememberedChoice<OutlineTab>('story:outline', 'tree');

  /** 按住右侧分隔线拖动：把面板拉宽 / 收窄 */
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const move = (moveEvent: PointerEvent): void => {
        onResize(clampOutlineWidth(startWidth + (moveEvent.clientX - startX)));
      };
      const end = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
    },
    [onResize, width],
  );

  return (
    <>
      <aside className="story-outline" style={{ width }}>
        <div className="outline-tabs" role="tablist" aria-label="章节、段落与流程图">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tree'}
            className={`outline-tab${tab === 'tree' ? ' active' : ''}`}
            onClick={() => chooseTab('tree')}
          >
            章节 / 段落
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'flow'}
            className={`outline-tab${tab === 'flow' ? ' active' : ''}`}
            onClick={() => chooseTab('flow')}
          >
            流程图
          </button>
        </div>

        <div className="outline-body">{tab === 'tree' ? tree : flow}</div>
      </aside>

      <div
        className="outline-handle"
        title="按住左右拖动，调整章节 / 流程图这一栏的宽度"
        onPointerDown={startResize}
      />
    </>
  );
}
