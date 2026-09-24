import type { LineKind } from '../core/types';
import { BLOCK_MIME, SCRIPT_BLOCKS } from './script-blocks';

interface Props {
  /** 单击脚本块：直接在当前段落最后加一行 */
  onPick: (kind: LineKind) => void;
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
          key={block.kind}
          type="button"
          className={`script-block block-${block.kind}`}
          draggable
          title={`拖到列表里插入「${block.name}」，或单击直接加到最后一行`}
          onClick={() => onPick(block.kind)}
          onDragStart={(event) => {
            event.dataTransfer.setData(BLOCK_MIME, block.kind);
            event.dataTransfer.effectAllowed = 'copy';
          }}
        >
          <span className={`type-tag type-${block.kind}`}>{block.name}</span>
          <span className="script-block-note">{block.note}</span>
        </button>
      ))}
    </div>
  );
}
