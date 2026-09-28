import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** 最多长到两行，再多就在框里滚动 */
const MAX_ROWS = 2;

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

/**
 * 会自己长高的文本框：初始一行高，内容换行时自动加高，最多两行。
 *
 * textarea 里的文字没法像单行输入框那样垂直居中（浏览器不给这个能力），
 * 所以按需求换成"一行高 + 换行才长高"：没有换行的短文本在框里就是上下留白均匀的
 * 一行，长了才往下长，不会一上来就占两行。
 */
export function AutoGrowTextarea({ value, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    // 上下内边距 + 上下边框：box-sizing 是 border-box，写 height 时要连边框一起算
    const chrome =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom) +
      Number.parseFloat(styles.borderTopWidth) +
      Number.parseFloat(styles.borderBottomWidth);
    // 拿不到行高、或环境里根本没有排版（jsdom）时不动它，交给 rows={1} 兜着
    if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isFinite(chrome)) return;

    el.style.height = 'auto';
    const content = el.scrollHeight;
    if (content === 0) return;

    const border =
      Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
    const limit = lineHeight * MAX_ROWS + chrome;
    const target = Math.min(content + border, limit);

    el.style.height = `${target}px`;
    el.style.overflowY = content + border > limit ? 'auto' : 'hidden';
  }, [value]);

  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}
