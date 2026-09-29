// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useTypingFocus } from './useTypingFocus';

afterEach(() => {
  cleanup();
});

describe('useTypingFocus', () => {
  it('什么都没聚焦时不算在编辑', () => {
    const { result } = renderHook(() => useTypingFocus());

    expect(result.current).toBe(false);
  });

  it('输入框拿到焦点就算在编辑，失焦就不算', () => {
    const { result } = renderHook(() => useTypingFocus());
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => input.focus());
    expect(result.current).toBe(true);

    act(() => input.blur());
    expect(result.current).toBe(false);

    input.remove();
  });

  it('焦点在按钮上不算——那不是「在编辑」', () => {
    const { result } = renderHook(() => useTypingFocus());
    const button = document.createElement('button');
    document.body.appendChild(button);

    act(() => button.focus());
    expect(result.current).toBe(false);

    button.remove();
  });

  it('窗口整个失焦（切去别的程序）就不算在编辑', () => {
    const { result } = renderHook(() => useTypingFocus());
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => input.focus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBe(false);

    input.remove();
  });
});
