'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LVLogoText } from '@/components/ui/lv-logo';
import { useTheme } from '@/components/layout/theme-provider';
import {
  LayoutDashboard,
  Package,
  Warehouse,
  PackageCheck,
  FileSpreadsheet,
  Building2,
  ShoppingCart,
  Megaphone,
  Tag,
  Calculator,
  Settings,
  Sun,
  Moon,
  Search,
} from 'lucide-react';

const navItems = [
  { title: '대시보드',    href: '/',              icon: LayoutDashboard, exact: true,  section: 'main' },
  { title: '마스터 시트', href: '/master',        icon: FileSpreadsheet, exact: false, section: 'main' },
  { title: '상품 관리',   href: '/products',      icon: Package,         exact: false, section: 'data' },
  { title: '공급처 관리', href: '/suppliers',      icon: Building2,       exact: false, section: 'data' },
  { title: '재고 관리',   href: '/inventory',     icon: Warehouse,       exact: false, section: 'ops' },
  { title: '입출고 관리', href: '/inbound',       icon: PackageCheck,    exact: false, section: 'ops' },
  { title: '채널 판매',   href: '/channel-sales', icon: ShoppingCart,    exact: false, section: 'sales' },
  { title: '광고 분석',   href: '/ad-analysis',   icon: Megaphone,       exact: false, section: 'sales' },
  { title: '가격 분석',   href: '/price-tool',    icon: Tag,             exact: false, section: 'sales' },
  { title: '소싱 분석',   href: '/sourcing',      icon: Search,          exact: false, section: 'sales' },
  { title: '정산',        href: '/settlement',    icon: Calculator,      exact: false, section: 'etc' },
  { title: '설정',        href: '/settings',      icon: Settings,        exact: false, section: 'etc' },
];

const sections: { key: string; label: string }[] = [
  { key: 'main', label: '' },
  { key: 'data', label: '데이터' },
  { key: 'ops', label: '운영' },
  { key: 'sales', label: '판매' },
  { key: 'etc', label: '' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <aside
      className="hidden md:flex md:w-[220px] md:flex-col md:fixed md:inset-y-0 backdrop-blur-xl"
      style={{
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {/* 로고 */}
      <div className="flex items-center h-14 px-4">
        <LVLogoText size={28} />
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-2.5 pt-1 overflow-y-auto">
        {sections.map(({ key, label }) => {
          const items = navItems.filter((i) => i.section === key);
          if (!items.length) return null;
          return (
            <div key={key} className={label ? 'mt-4' : ''}>
              {label && (
                <p
                  className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {label}
                </p>
              )}
              {items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] font-medium transition-all duration-100',
                    )}
                    style={{
                      color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'var(--accent-blue-bg)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <item.icon
                      className="h-4 w-4 shrink-0"
                      strokeWidth={isActive ? 2.2 : 1.8}
                      style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text-tertiary)' }}
                    />
                    {item.title}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* 하단: 테마 토글 */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={toggle}
          className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[6px] text-[12px] font-medium transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {theme === 'light' ? (
            <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />
          ) : (
            <Sun className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
          {theme === 'light' ? '다크 모드' : '라이트 모드'}
        </button>
      </div>
    </aside>
  );
}
