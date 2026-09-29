/**
 * 光标是不是真的在输入框里。
 *
 * 「正在编辑哪个模块」不能只看开了哪个模块——人切去别的窗口、或者只是把界面晾在
 * 那儿，圆点还亮着，比不亮更让人误会。所以两个条件都要：窗口有焦点，且活动元素
 * 是个输入控件。
 */

import { useEffect, useState } from 'react';

function isTextField(element: Element | null): boolean {
  if (element === null || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useTypingFocus(): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const update = (): void => setTyping(isTextField(document.activeElement));
    // 窗口整个失焦（切去别的程序）就不算在编辑了
    const leave = (): void => setTyping(false);

    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', leave);
    update();

    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', leave);
    };
  }, []);

  return typing;
}
