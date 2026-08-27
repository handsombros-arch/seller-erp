'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: '쿠팡', href: '/ad-analysis' },
  { label: '토스', href: '/ad-analysis/toss' },
  { label: '스마트스토어', href: '/ad-analysis/smartstore' },
];

export default function AdAnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line-2">
        {TABS.map((t) => {
          const active = t.href === '/ad-analysis' ? pathname === '/ad-analysis' : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand text-fg'
                  : 'border-transparent text-fg-3 hover:text-fg'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
