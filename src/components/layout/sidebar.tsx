'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LVLogoText } from '@/components/ui/lv-logo';
import { useTheme } from '@/components/layout/theme-provider';
import { navItems, navSections, isNavActive } from '@/config/nav';
import { Sun, Moon } from 'lucide-react';

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
        {navSections.map(({ key, label }) => {
          const items = navItems.filter((i) => i.section === key);
          if (!items.length) return null;
          return (
            <div key={key} className={label ? 'mt-4' : ''}>
              {label && (
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-5">
                  {label}
                </p>
              )}
              {items.map((item) => {
                const isActive = isNavActive(item, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] font-medium transition-colors duration-100',
                      isActive
                        ? 'bg-brand-bg text-brand'
                        : 'text-fg-2 hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <item.icon
                      className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-fg-4')}
                      strokeWidth={isActive ? 2.2 : 1.8}
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
          className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[6px] text-[12px] font-medium text-fg-3 transition-colors hover:bg-[var(--bg-hover)]"
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
