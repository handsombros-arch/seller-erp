'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 넓게 보기 — 사이드바를 숨기고 본문 폭 제한(1200px)을 푼다. 표가 넓은 화면(마스터 시트 등)용.
 * - 사용자가 헤더 버튼으로 켜고 끄며 localStorage 에 기억된다.
 * - 아직 한 번도 안 정했으면 WIDE_BY_DEFAULT 경로에서는 켜진 상태로 시작한다.
 * 실제 레이아웃은 CSS 변수 --sidebar-w (220px ↔ 0px) 로 움직여서, 고정 저장 바 등도 같이 따라온다.
 */
const KEY = 'lv-erp-wide';
const WIDE_BY_DEFAULT = ['/master'];

const WideContext = createContext<{ wide: boolean; toggle: () => void }>({ wide: false, toggle: () => {} });
export const useWide = () => useContext(WideContext);

export function WideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pref, setPref] = useState<boolean | null>(null);   // null = 사용자가 아직 안 정함
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const v = localStorage.getItem(KEY); setPref(v == null ? null : v === 'on'); } catch {} setReady(true); }, []);
  const wide = ready && (pref ?? WIDE_BY_DEFAULT.some(p => pathname?.startsWith(p)));
  const toggle = useCallback(() => {
    setPref(() => { const next = !wide; try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch {} return next; });
  }, [wide]);
  return (
    <WideContext.Provider value={{ wide, toggle }}>
      <div style={{ ['--sidebar-w' as string]: wide ? '0px' : '220px' }} data-wide={wide ? '1' : undefined}>
        {children}
      </div>
    </WideContext.Provider>
  );
}

/** 본문 래퍼 — 넓게 보기면 폭 제한 없음 */
export function MainShell({ children }: { children: React.ReactNode }) {
  const { wide } = useWide();
  return <main className={wide ? 'p-4 md:p-6' : 'p-4 md:p-6 max-w-[1200px] mx-auto'}>{children}</main>;
}
