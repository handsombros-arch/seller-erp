'use client';

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ⓘ 아이콘에 마우스를 올리면 나오는 짧은 설명 — 계산 공식·정책처럼 "왜 이 숫자인가"를 적는 곳.
 * 금액·비율 같은 사실 정보는 카드 본문에 그대로 두고, 이 툴팁에는 정책만 넣는다.
 * 순수 CSS(hover/focus) 라 라이브러리 없이 어디서나 쓸 수 있다.
 */
export function InfoTip({ text, className, side = 'top' }: { text: string; className?: string; side?: 'top' | 'bottom' }) {
  return (
    <span className={cn('relative inline-flex group/tip align-middle', className)}>
      <button type="button" tabIndex={0} aria-label={text} className="p-0.5 rounded-full text-fg-5 hover:text-fg-3 focus:outline-none focus:text-brand cursor-help">
        <Info className="h-3 w-3" />
      </button>
      <span role="tooltip" className={cn(
        'pointer-events-none absolute left-1/2 -translate-x-1/2 z-30 w-max max-w-[260px] rounded-lg bg-fg text-app px-2.5 py-1.5 text-[11px] font-normal leading-snug whitespace-pre-line shadow-lg',
        'opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible group-focus-within/tip:opacity-100 group-focus-within/tip:visible transition-opacity',
        side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
      )}>{text}</span>
    </span>
  );
}
