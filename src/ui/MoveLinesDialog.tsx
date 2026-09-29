import { useState } from 'react';

import type { Chapter } from '../core/types';

interface Props {
  /** 全部章节，供目标章节下拉使用 */
  chapters: Chapter[];
  /** 当前打开的段落 */
  sourceGroupUid: string;
  /** 要搬几行 */
  count: number;
  /**
   * 预先选好的目标段落。
   *
   * 从工具栏点「移动至」进来时是空串（还没选）；从流程图拖段落块上过来时
   * 就是被拖到的那个段落，直接填好。
   */
  targetGroupUid: string;
  onMove: (targetGroupUid: string, position: 'start' | 'end') => void;
  onCancel: () => void;
}

/**
 * 「移动至」弹窗。
 *
 * 目标章节 / 目标段落两级下拉，加两个竖排按钮选插入位置：
 * 点哪个按钮就用哪个位置搬，顺序在按钮上写清楚，不用再点一次「确定」。
 */
export function MoveLinesDialog({
  chapters,
  sourceGroupUid,
  count,
  targetGroupUid,
  onMove,
  onCancel,
}: Props) {
  /** 目标段落所在的那一章：拖过来时按它回填第一级 */
  const chapterOfTarget = chapters.find((chapter) =>
    chapter.groups.some((group) => group.uid === targetGroupUid),
  );
  const [chapterUid, setChapterUid] = useState(
    chapterOfTarget?.uid ?? chapters.find((c) => c.groups.some((g) => g.uid === sourceGroupUid))?.uid ?? '',
  );
  const [groupUid, setGroupUid] = useState(targetGroupUid);

  const chapter = chapters.find((item) => item.uid === chapterUid);
  const target = chapters
    .flatMap((item) => item.groups)
    .find((group) => group.uid === groupUid);
  const canMove = target !== undefined;

  const move = (position: 'start' | 'end'): void => {
    if (!canMove) return;
    onMove(groupUid, position);
  };

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div
        className="modal move-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>移动 {count} 行到</header>

        <div className="modal-body">
          <label className="move-field">
            <span className="line-field-name">目标章节</span>
            <select
              value={chapterUid}
              title="目标章节"
              onChange={(event) => {
                const next = chapters.find((item) => item.uid === event.target.value);
                setChapterUid(event.target.value);
                // 换章节时先默认该章节的第一个段落，省一次点击
                setGroupUid(next?.groups[0]?.uid ?? '');
              }}
            >
              <option value="">（选择章节）</option>
              {chapters.map((item) => (
                <option key={item.uid} value={item.uid}>
                  {item.title || item.id}
                </option>
              ))}
            </select>
          </label>

          <label className="move-field">
            <span className="line-field-name">目标段落</span>
            <select
              value={groupUid}
              disabled={chapter === undefined}
              title="目标段落（该章节内）"
              onChange={(event) => setGroupUid(event.target.value)}
            >
              {chapter === undefined ? (
                <option value="">—</option>
              ) : (
                chapter.groups.map((group) => (
                  <option key={group.uid} value={group.uid}>
                    {group.title || group.id}（{group.lines.length} 行）
                  </option>
                ))
              )}
            </select>
          </label>

          {/* 两个位置按钮竖排：点哪个就按哪个位置搬，不用再确认一次 */}
          <div className="move-actions">
            <button
              type="button"
              className="primary"
              disabled={!canMove}
              title="插到目标段落现有内容的前面"
              onClick={() => move('start')}
            >
              插入到开头
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canMove}
              title="插到目标段落现有内容的后面"
              onClick={() => move('end')}
            >
              插入到末尾
            </button>
          </div>
        </div>

        <footer>
          <button type="button" autoFocus onClick={onCancel}>
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}
