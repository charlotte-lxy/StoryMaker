// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetViewMemory, useScrollMemory } from './view-memory';

/** jsdom 不做排版，scrollTop 永远是 0：临时代替成真能存取的 */
function stubScrollTop(): () => void {
  const tops = new WeakMap<HTMLElement, number>();
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      // 真浏览器里，已经从文档摘掉的元素读出来就是 0，桩也照这个来
      return this.isConnected ? (tops.get(this) ?? 0) : 0;
    },
    set(this: HTMLElement, value: number) {
      tops.set(this, value);
    },
  });
  return () => {
    delete (HTMLElement.prototype as unknown as { scrollTop?: unknown }).scrollTop;
  };
}

function Box({ name }: { name: string }) {
  const ref = useScrollMemory(name);
  return <div className="box" ref={ref} />;
}

function Host({ show, name }: { show: boolean; name: string }) {
  return <div>{show && <Box name={name} />}</div>;
}

describe('滚动位置记忆的 hook', () => {
  beforeEach(() => {
    resetViewMemory();
  });
  afterEach(() => {
    cleanup();
  });

  it('元素卸下再挂上，位置还原', () => {
    const restore = stubScrollTop();
    try {
      const view = render(<Host show name="box" />);
      const first = view.container.querySelector('.box') as HTMLElement;
      first.scrollTop = 180;
      fireEvent.scroll(first);

      view.rerender(<Host show={false} name="box" />);
      view.rerender(<Host show name="box" />);

      expect((view.container.querySelector('.box') as HTMLElement).scrollTop).toBe(180);
    } finally {
      restore();
    }
  });

  it('不同 key 各记各的', () => {
    const restore = stubScrollTop();
    try {
      const view = render(<Host show name="a" />);
      const first = view.container.querySelector('.box') as HTMLElement;
      first.scrollTop = 50;
      fireEvent.scroll(first);
      view.rerender(<Host show={false} name="a" />);
      view.rerender(<Host show name="b" />);
      expect((view.container.querySelector('.box') as HTMLElement).scrollTop).toBe(0);
    } finally {
      restore();
    }
  });
});
