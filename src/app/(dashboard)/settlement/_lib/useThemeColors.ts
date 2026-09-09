'use client';

import { useEffect, useState } from 'react';

const KEYS = { fg: '--color-fg', fg4: '--color-fg-4', brand: '--color-brand', info: '--color-info', success: '--color-success', warn: '--color-warn', danger: '--color-danger', line: '--color-line', line2: '--color-line-2', card: '--color-card' } as const;
type Colors = Record<keyof typeof KEYS, string>;
const FALLBACK: Colors = { fg: '#191F28', fg4: '#8B95A1', brand: '#3182F6', info: '#8B5CF6', success: '#10B981', warn: '#F97316', danger: '#F43F5E', line: '#E5E8EB', line2: '#F2F4F6', card: '#FFFFFF' };

/** SVG(recharts) 속성은 CSS 변수를 못 읽으므로 테마 토큰의 실제 값을 가져온다. 다크 모드 전환도 반영. */
export function useThemeColors(): Colors {
  const [colors, setColors] = useState<Colors>(FALLBACK);
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next = { ...FALLBACK };
      for (const k of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
        const v = cs.getPropertyValue(KEYS[k]).trim();
        if (v) next[k] = v;
      }
      setColors(next);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}
