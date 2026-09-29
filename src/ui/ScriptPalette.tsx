import { BLOCK_MIME, SCRIPT_BLOCKS, type BlockId } from './script-blocks';

interface Props {
  /** 单击脚本块：直接在当前段落最后加一行 */
  onPick: (blockId: BlockId) => void;
}

/**
 * 对话列表最下方的脚本块条。
 *
 * 两种用法：按住块拖到上面的列表里，在放下的位置插入一行；
 * 或者直接单击，加到当前段落的最后一行。
 */
export function ScriptPalette({ onPick }: Props) {
  return (
    <div className="palette">
      <span className="palette-head" title="拖到上面的列表里插入，或单击直接加到最后一行">
        脚本块
      </span>

      {SCRIPT_BLOCKS.map((block) => (
        <button
          key={block.id}
          type="button"
          className={`script-block block-${block.id}`}
          draggable
          title={`拖到列表里插入「${block.name}」，或单击直接加到最后一行`}
          onClick={() => onPick(block.id)}
          onDragStart={(event) => {
            event.dataTransfer.setData(BLOCK_MIME, block.id);
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {/* 「跳转到段落」导出时也是「指令」行，标签沿用指令的配色 */}
          <span className={`type-tag type-${block.id === '跳转到段落' ? '指令' : block.id}`}>
            {block.name}
          </span>
          <span className="script-block-note">{block.note}</span>
        </button>
      ))}
    </div>
  );
}
