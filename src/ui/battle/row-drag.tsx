import { useState, type DragEvent } from 'react';

/**
 * 表格行的拖拽排序（战斗模块六张主表共用）。
 *
 * 把手单独放在最左边那格、只有它可拖：这些表里几乎整行都是输入框，
 * 整行可拖会跟"在输入框里拖选文字"打架。
 */
export interface RowDrag {
  /** 挂到 <tr> 上 */
  rowProps: (index: number) => {
    className: string;
    onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
    onDrop: (event: DragEvent<HTMLTableRowElement>) => void;
  };
  /** 挂到把手 <span> 上 */
  handleProps: (index: number) => {
    draggable: true;
    onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
    onDragEnd: () => void;
  };
}

export function useRowDrag(onReorder: (from: number, to: number) => void): RowDrag {
  /** 正在被拖的行下标 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** 指针停在谁身上（只为了画一根插入线） */
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const clear = (): void => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return {
    rowProps: (index) => ({
      className: [
        'line-row',
        dragIndex === index ? 'dragging' : '',
        dragIndex !== null && overIndex === index && dragIndex !== index ? 'drop-target' : '',
      ]
        .filter(Boolean)
        .join(' '),
      onDragOver: (event) => {
        if (dragIndex === null) return;
        event.preventDefault();
        setOverIndex(index);
      },
      onDrop: (event) => {
        if (dragIndex === null) return;
        event.preventDefault();
        const from = dragIndex;
        clear();
        onReorder(from, index);
      },
    }),
    handleProps: (index) => ({
      draggable: true,
      onDragStart: (event) => {
        setDragIndex(index);
        event.dataTransfer.effectAllowed = 'move';
      },
      onDragEnd: clear,
    }),
  };
}

/** 最左边那一格：一根拖拽把手，别的什么都不放 */
export function OrderCell({ index, drag }: { index: number; drag: RowDrag }) {
  return (
    <td className="cell-order">
      <span className="drag-handle" title="按住上下拖动可调整顺序" {...drag.handleProps(index)} />
    </td>
  );
}
