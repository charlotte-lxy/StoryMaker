// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoGrowTextarea } from './AutoGrowTextarea';

/**
 * jsdom 没有排版，所以这里把"量出来的数字"全部接管：
 * 行高、内边距、边框给固定的，内容高度和框宽随时可改，
 * 再装一个假的 ResizeObserver 手动触发通知，模拟页面缩放 / 拉窗口。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {
    // 不需要真观察谁：测试里手动 notify
  }

  disconnect(): void {
    // 同上
  }

  notify(): void {
    this.callback();
  }
}

/** 内容高度：也就是"文字实际要几行" */
const content = { height: 28 };
/** 文本框宽度：页面缩放后列变窄，这个值会变 */
const box = { width: 300 };

const noop = (): void => undefined;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  content.height = 28;
  box.width = 300;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    lineHeight: '20px',
    paddingTop: '4px',
    paddingBottom: '4px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
  } as unknown as CSSStyleDeclaration);
  Object.defineProperty(HTMLTextAreaElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => box.width,
  });
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => content.height,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLTextAreaElement.prototype as unknown as { clientWidth?: unknown }).clientWidth;
  delete (HTMLTextAreaElement.prototype as unknown as { scrollHeight?: unknown }).scrollHeight;
});

describe('会自己长高的文本框', () => {
  it('一行装得下就一行高（30px），内容换行了才长到两行（50px）', () => {
    const view = render(<AutoGrowTextarea value="短" onChange={noop} />);
    const el = view.container.querySelector('textarea') as HTMLTextAreaElement;

    // 一行：20 行高 + 上下各 4 内边距 + 上下各 1 边框
    expect(el.style.height).toBe('30px');
    expect(el.style.overflowY).toBe('hidden');

    // 文字变长、要换行了
    content.height = 48;
    view.rerender(<AutoGrowTextarea value="长一点的内容" onChange={noop} />);
    expect(el.style.height).toBe('50px');
  });

  it('超过两行就封顶两行，多出来的在框里滚动', () => {
    content.height = 200;
    const view = render(<AutoGrowTextarea value="很长" onChange={noop} />);
    const el = view.container.querySelector('textarea') as HTMLTextAreaElement;

    expect(el.style.height).toBe('50px');
    expect(el.style.overflowY).toBe('auto');
  });

  it('页面缩放让列变窄时自己重新算高度，不必切界面重挂载', () => {
    const view = render(<AutoGrowTextarea value="短" onChange={noop} />);
    const el = view.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(el.style.height).toBe('30px');

    // 放大页面：列变窄，这段文字从一行挤成两行
    box.width = 120;
    content.height = 48;
    FakeResizeObserver.instances[0].notify();
    expect(el.style.height).toBe('50px');

    // 缩回去：又变回一行
    box.width = 300;
    content.height = 28;
    FakeResizeObserver.instances[0].notify();
    expect(el.style.height).toBe('30px');
  });

  it('宽度没变就不重算，免得改高度又触发自己', () => {
    const view = render(<AutoGrowTextarea value="短" onChange={noop} />);
    const el = view.container.querySelector('textarea') as HTMLTextAreaElement;

    // 宽度没变、只是内容高度读数变了：不动它
    content.height = 48;
    FakeResizeObserver.instances[0].notify();

    expect(el.style.height).toBe('30px');
  });
});
