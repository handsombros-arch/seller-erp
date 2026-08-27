'use client';

import { usePathname } from 'next/navigation';
import { Tabs } from '@/components/ui/tabs';

const TABS = [
  { value: 'coupang', label: '쿠팡', href: '/ad-analysis' },
  { value: 'toss', label: '토스', href: '/ad-analysis/toss' },
  { value: 'smartstore', label: '스마트스토어', href: '/ad-analysis/smartstore' },
] as const;

export default function AdAnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname.startsWith('/ad-analysis/toss') ? 'toss' : pathname.startsWith('/ad-analysis/smartstore') ? 'smartstore' : 'coupang';

  return (
    <div className="space-y-4">
      <Tabs items={TABS} value={current} />
      {children}
    </div>
  );
}
