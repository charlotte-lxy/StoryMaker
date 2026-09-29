interface Props {
  /** 当前段落一共多少行 */
  totalCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** 打开「移动至」弹窗：目标段落和插入位置都在弹窗里选 */
  onMoveTo: () => void;
  onRemove: () => void;
}

/**
 * 对话列表的批量编辑工具条。
 *
 * 只在批量编辑模式里出现：勾选、取消选择、全选、搬到别的段落、整批删除。
 * 「移动至」点开的是弹窗——目标章节 / 段落和"插到开头还是末尾"都在弹窗里选，
 * 免得在工具条上误碰下拉就把内容挪走。
 */
export function BatchEditBar({
  totalCount,
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onMoveTo,
  onRemove,
}: Props) {
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
        className="mini"
        title="取消勾选，留在批量编辑模式里"
        disabled={selectedCount === 0}
        onClick={onDeselectAll}
      >
        取消选择
      </button>

      <button
        type="button"
        className="mini"
        title="把勾选的行搬到别的段落"
        disabled={selectedCount === 0}
        onClick={onMoveTo}
      >
        移动至
      </button>

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
