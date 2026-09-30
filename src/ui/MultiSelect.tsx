import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { looksLikeUid } from '../core/refs';

/** 候选：值是那一行的 uid，标签才是给人看的名字 */
export interface MultiOption {
  value: string;
  label: string;
}

interface Props {
  /** 已经选中的 uid */
  values: string[];
  /** 候选，来自对应的表 */
  options: MultiOption[];
  /** 一个都没选时按钮上显示的字 */
  placeholder: string;
  title?: string;
  onChange: (next: string[]) => void;
}

/** 浮层最多这么高，再高就在里面滚 */
const MAX_MENU_HEIGHT = 260;
/** 离窗口边缘至少留这么多 */
const EDGE = 8;

interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/**
 * 多选下拉：按钮上显示已选的名字，点开是勾选清单。
 *
 * 存的是各表的 uid（改名字、改 ID 都不会把引用写坏），显示的是那一行的名字。
 * 不用 <select multiple>：它要按住 Ctrl 点，策划用起来容易漏选、也看不出选了什么。
 * 已经不在候选里的（比如引用的技能被删了）也会列出来并标出来，方便取消勾选。
 *
 * 清单挂在 body 上（portal）而不是按钮里面：战斗模块的表格外面套着横向滚动的容器，
 * 挂在按钮里的话，最后一行的清单会被那一层 overflow 整块裁掉，一个选项都看不到。
 * 位置按按钮当前的位置算，下方放不下就翻到上方。
 */
export function MultiSelect({ values, options, placeholder, title, onChange }: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openMenu = (): void => {
    const button = buttonRef.current;
    if (button === null) return;
    const box = button.getBoundingClientRect();
    setAnchor(box);
    // 先按「贴在按钮下方」渲染一版（先藏着，量完高度再亮出来，避免跳一下）
    setPlacement({ left: box.left, top: box.bottom + 4, width: box.width, maxHeight: MAX_MENU_HEIGHT });
  };

  const close = (): void => {
    setAnchor(null);
    setPlacement(null);
  };

  // 量出清单的真实高度，决定向下还是向上弹，并把它压在窗口里。
  // 这是 useLayoutEffect：位置在浏览器绘制之前就算好了，看不到跳动。
  useLayoutEffect(() => {
    if (anchor === null) return;
    const menu = menuRef.current;
    if (menu === null) return;

    const height = menu.offsetHeight;
    const width = Math.max(anchor.width, 190);
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - EDGE - width));
    const below = window.innerHeight - anchor.bottom - EDGE - 4;
    const above = anchor.top - EDGE - 4;

    if (height <= below || below >= above) {
      setPlacement({
        left,
        top: anchor.bottom + 4,
        width,
        maxHeight: Math.max(120, Math.min(MAX_MENU_HEIGHT, below)),
      });
      return;
    }
    const maxHeight = Math.max(120, Math.min(MAX_MENU_HEIGHT, above));
    setPlacement({ left, top: anchor.top - 4 - Math.min(height, maxHeight), width, maxHeight });
  }, [anchor]);

  const labelOf = (value: string): string =>
    options.find((item) => item.value === value)?.label ?? value;

  const toggle = (value: string): void => {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const missing = values.filter((value) => !options.some((item) => item.value === value));

  return (
    <div className="multi-select">
      <button
        ref={buttonRef}
        type="button"
        className="multi-toggle"
        title={title ?? '点开勾选'}
        onClick={() => (anchor === null ? openMenu() : close())}
      >
        {values.length === 0 ? (
          <span className="multi-placeholder">{placeholder}</span>
        ) : (
          <span className="multi-values">{values.map(labelOf).join('、')}</span>
        )}
        <span className="multi-caret">{anchor === null ? '▼' : '▲'}</span>
      </button>

      {placement !== null &&
        createPortal(
          <>
            <div className="multi-mask" onClick={close} />
            <div
              className="multi-menu"
              ref={menuRef}
              style={{
                left: placement.left,
                top: placement.top,
                minWidth: placement.width,
                maxHeight: placement.maxHeight,
              }}
            >
              {options.length === 0 && missing.length === 0 ? (
                <div className="multi-empty">这张表里还没有条目</div>
              ) : (
                <>
                  {options.map((item) => (
                    <label key={item.value} className="multi-option">
                      <input
                        type="checkbox"
                        checked={values.includes(item.value)}
                        onChange={() => toggle(item.value)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                  {missing.map((value) => (
                    <label key={value} className="multi-option missing" title="这个引用已经不在表里了">
                      <input type="checkbox" checked onChange={() => toggle(value)} />
                      {/* uid 读不出是哪一条，就别把乱码摆出来 */}
                      <span>{looksLikeUid(value) ? '已不在表里的条目' : `${value}（已不在表里）`}</span>
                    </label>
                  ))}
                </>
              )}

              {values.length > 0 && (
                <button type="button" className="mini multi-clear" onClick={() => onChange([])}>
                  清空选择
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
