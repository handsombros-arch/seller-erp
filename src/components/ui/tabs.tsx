'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─────────────────────────────────────────────────────────────
   탭 UX 규칙
   - 페이지 뷰 전환(1단계)      → <Tabs>            밑줄형, 13px, 아이콘/카운트 가능, URL ?tab= 동기화 권장
   - 카드 안 옵션 전환(2단계)   → <SegmentedControl> 알약형, 12px, 28px 높이
   - 링크 탭(라우트 전환)       → <Tabs> items[].href
   ───────────────────────────────────────────────────────────── */

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: LucideIcon;
  count?: number | string;
  href?: string;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange?: (value: T) => void;
  className?: string;
  /** 'md' 13px(기본) · 'sm' 12px */
  size?: 'md' | 'sm';
}

/** 1단계: 밑줄형 탭 (페이지 뷰 전환) */
export function Tabs<T extends string>({ items, value, onChange, className, size = 'md' }: TabsProps<T>) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-line overflow-x-auto', className)}>
      {items.map((it) => {
        const active = it.value === value;
        const Icon = it.icon;
        const cls = cn(
          'relative flex items-center gap-1.5 whitespace-nowrap border-b-2 -mb-px font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-t-md',
          size === 'md' ? 'px-3.5 py-2.5 text-[13px]' : 'px-3 py-2 text-[12px]',
          active ? 'border-fg text-fg' : 'border-transparent text-fg-4 hover:text-fg',
          it.disabled && 'opacity-50 pointer-events-none',
        );
        const inner = (
          <>
            {Icon && <Icon className={cn('h-4 w-4', active ? 'text-fg' : 'text-fg-5')} strokeWidth={active ? 2.2 : 1.8} />}
            {it.label}
            {it.count !== undefined && (
              <span className={cn('ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', active ? 'bg-brand-bg text-brand' : 'bg-app text-fg-4')}>
                {it.count}
              </span>
            )}
          </>
        );
        if (it.href) {
          return (
            <Link key={it.value} href={it.href} role="tab" aria-selected={active} className={cls}>
              {inner}
            </Link>
          );
        }
        return (
          <button key={it.value} type="button" role="tab" aria-selected={active} onClick={() => onChange?.(it.value)} className={cls}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  items: readonly { value: T; label: React.ReactNode; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** 'sm' 28px(기본, 카드 안) · 'md' 32px */
  size?: 'sm' | 'md';
}

/** 2단계: 알약형 세그먼트 (카드 안 옵션 전환 — 기간·단위·지면 등) */
export function SegmentedControl<T extends string>({ items, value, onChange, className, size = 'sm' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center gap-0.5 rounded-[10px] bg-app p-[3px] shrink-0', className)}>
      {items.map((it) => {
        const active = it.value === value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
              size === 'sm' ? 'h-[26px] px-2.5 text-[12px]' : 'h-[30px] px-3 text-[13px]',
              active ? 'bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-fg-3 hover:text-fg',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 탭 상태를 URL 쿼리(?key=value)와 동기화. 새로고침·뒤로가기·링크 공유 시 탭 유지.
 * 허용값 밖이면 defaultValue.
 */
export function useTabParam<T extends string>(key: string, values: readonly T[], defaultValue: T): [T, (v: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(key);
  const value = (values as readonly string[]).includes(raw ?? '') ? (raw as T) : defaultValue;
  const set = useCallback(
    (v: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (v === defaultValue) params.delete(key);
      else params.set(key, v);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, key, defaultValue],
  );
  return [value, set];
}
