import { useState } from 'react';

import type { Chapter } from '../core/types';

interface Props {
  /** 全部章节，供「移动至」的第一级下拉使用 */
  chapters: Chapter[];
  /** 当前打开的段落：移动的目标不能是它自己 */
  sourceGroupUid: string;
  /** 当前段落一共多少行 */
  totalCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onMove: (targetGroupUid: string) => void;
  onRemove: () => void;
}

/**
 * 对话列表的批量编辑工具条。
 *
 * 只在批量编辑模式里出现：勾选、全选、搬到别的段落、整批删除。
 * 「移动至」点开后才是两级下拉——先选章节，再选该章节里的段落，
 * 两个都选好还要再点一次「移动」才真的搬，免得手滑碰到下拉就把内容挪走。
 */
export function BatchEditBar({
  chapters,
  sourceGroupUid,
  totalCount,
  selectedCount,
  onSelectAll,
  onMove,
  onRemove,
}: Props) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetChapterUid, setTargetChapterUid] = useState('');
  const [targetGroupUid, setTargetGroupUid] = useState('');

  const targetChapter = chapters.find((chapter) => chapter.uid === targetChapterUid);
  const canMove = selectedCount > 0 && targetGroupUid !== '' && targetGroupUid !== sourceGroupUid;

  return (
    <div className="batch-bar">
      <span className="batch-count">
        已选 {selectedCount} / {totalCount} 行
      </span>

      <button
        type="button"
        className="mini"
        title="勾选当前段落的全部行"
        disabled={totalCount === 0}
        onClick={onSelectAll}
      >
        全选
      </button>

      <button
        type="button"
        className={`mini${moveOpen ? ' on' : ''}`}
        title="把勾选的行整段搬到别的段落"
        onClick={() => setMoveOpen((open) => !open)}
      >
        移动至
      </button>

      {moveOpen && (
        <span className="batch-move">
          <select
            value={targetChapterUid}
            title="第一级：目标章节"
            onChange={(event) => {
              const next = chapters.find((chapter) => chapter.uid === event.target.value);
              setTargetChapterUid(event.target.value);
              // 换章节时先默认该章节的第一个段落，省一次点击
              setTargetGroupUid(next?.groups[0]?.uid ?? '');
            }}
          >
            <option value="">（选择章节）</option>
            {chapters.map((chapter) => (
              <option key={chapter.uid} value={chapter.uid}>
                {chapter.title || chapter.id}
              </option>
            ))}
          </select>

          <select
            value={targetGroupUid}
            disabled={targetChapter === undefined}
            title="第二级：目标段落（该章节内）"
            onChange={(event) => setTargetGroupUid(event.target.value)}
          >
            {targetChapter === undefined ? (
              <option value="">—</option>
            ) : (
              targetChapter.groups.map((group) => (
                <option key={group.uid} value={group.uid}>
                  {group.title || group.id}（{group.lines.length} 行）
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            className="mini on"
            disabled={!canMove}
            title={
              targetGroupUid === sourceGroupUid
                ? '目标段落就是当前段落'
                : '把勾选的行追加到目标段落末尾'
            }
            onClick={() => {
              onMove(targetGroupUid);
              setMoveOpen(false);
            }}
          >
            移动
          </button>
        </span>
      )}

      <button
        type="button"
        className="mini danger batch-remove"
        title="删除所有勾选的行"
        disabled={selectedCount === 0}
        onClick={onRemove}
      >
        批量删除
      </button>
    </div>
  );
}
