'use client';

import { useEffect } from 'react';

const SKIP_TYPES = new Set(['checkbox', 'radio', 'file', 'hidden', 'submit', 'button', 'reset', 'image']);

export function KoreanIME() {
  useEffect(() => {
    function applyLangKo(el: Element) {
      if (
        (el instanceof HTMLInputElement && !SKIP_TYPES.has(el.type)) ||
        el instanceof HTMLTextAreaElement
      ) {
        el.setAttribute('lang', 'ko');
      }
    }

    // 1. 기존 요소에 즉시 적용
    document.querySelectorAll('input, textarea').forEach(applyLangKo);

    // 2. 포커스 시점에 항상 적용 (가장 확실한 방법)
    function handleFocusIn(e: FocusEvent) {
      if (e.target instanceof Element) applyLangKo(e.target);
    }
    document.addEventListener('focusin', handleFocusIn, true);

    // 3. 동적으로 추가되는 요소에도 적용
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('input, textarea')) applyLangKo(node);
            node.querySelectorAll('input, textarea').forEach(applyLangKo);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
