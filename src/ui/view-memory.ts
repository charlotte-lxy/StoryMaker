import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * 页面滚动位置与子页面选择的记忆。
 *
 * 切模块（或切战斗 / 导出的子页面）时，那一页的组件会卸载，浏览器顺手把滚动位置
 * 也丢了，回来时又从头开始。这里在内存里按 key 存一份，元素重新挂上时还原：
 *   - 只记在内存里：既不进项目文件，也不落盘，重启就重来
 *   - **靠滚动事件记**，不在卸载时读：元素一开始卸载，页面布局就变了（其它部分先被
 *     摘掉、内容重排），此时读出来的 scrollTop 是被夹过 / 被 Scroll Anchoring 调过的
 *     值，拿它当记录反而把好数据冲掉
 */

const scrollTops = new Map<string, number>();
const choices = new Map<string, string>();

/** 只给测试用：清掉记住的位置与子页面选择，免得用例之间互相串 */
export function resetViewMemory(): void {
  scrollTops.clear();
  choices.clear();
}

/**
 * 记住某个滚动容器滚到哪儿了。
 *
 * @param key 唯一的名字，例如 'character'、'battle:effects'
 * @param alsoFill 需要同时拿到这个元素的普通 ref 时传进来（流程图那边要量尺寸）
 * @returns 挂到滚动容器上的 ref
 */
export function useScrollMemory<T extends HTMLElement>(
  key: string,
  alsoFill?: RefObject<T | null>,
): (node: T | null) => void {
  const [node, setNode] = useState<T | null>(null);

  const attach = useCallback(
    (next: T | null) => {
      if (alsoFill !== undefined) alsoFill.current = next;
      setNode(next);
    },
    [alsoFill],
  );

  useLayoutEffect(() => {
    if (node === null) return;

    const saved = scrollTops.get(key) ?? 0;
    node.scrollTop = saved;

    const remember = (): void => {
      scrollTops.set(key, node.scrollTop);
    };
    node.addEventListener('scroll', remember, { passive: true });

    // 流程图这类页面第一帧还没量出真实尺寸，滚不到底；而且挂载过程中其它部分的
    // 布局也可能带动滚动位置，下一帧再补一次
    const raf = window.requestAnimationFrame(() => {
      node.scrollTop = saved;
    });

    return () => {
      window.cancelAnimationFrame(raf);
      node.removeEventListener('scroll', remember);
    };
  }, [key, node]);

  return attach;
}

/**
 * 记住子页面选的是哪一个（战斗、导出、本地化的内层页签），
 * 回来时还停在离开时那一页——不然滚动位置就算记住了也对不上。
 */
export function useRememberedChoice<T extends string>(
  key: string,
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (choices.get(key) as T | undefined) ?? fallback);
  const choose = (next: T): void => {
    choices.set(key, next);
    setValue(next);
  };
  return [value, choose];
}
