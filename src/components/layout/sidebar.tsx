'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Package,
  Warehouse,
  PackageCheck,
  PackageMinus,
  TrendingUp,
  FileSpreadsheet,
  CalendarDays,
  Building2,
  ShoppingCart,
  Settings,
} from 'lucide-react';

const navItems = [
  { title: '대시보드',      href: '/',                icon: LayoutDashboard, exact: true,  sub: false },
  { title: '마스터 시트',   href: '/master',          icon: FileSpreadsheet, exact: false, sub: false },
  { title: '상품 관리',     href: '/products',        icon: Package,         exact: false, sub: true  },
  { title: '공급처 관리',   href: '/suppliers',       icon: Building2,       exact: false, sub: true  },
  { title: '재고 현황',     href: '/inventory',       icon: Warehouse,       exact: false, sub: false },
  { title: '입고 관리',     href: '/inbound',         icon: PackageCheck,    exact: false, sub: false },
  { title: '출고 관리',     href: '/outbound',        icon: PackageMinus,    exact: false, sub: false },
  { title: '채널 판매',     href: '/channel-sales',   icon: ShoppingCart,    exact: false, sub: false },
  { title: '재고 예측',     href: '/forecast',        icon: TrendingUp,      exact: false, sub: false },
  { title: '입출고 캘린더', href: '/calendar',        icon: CalendarDays,    exact: false, sub: false },
  { title: '설정',          href: '/settings',        icon: Settings,        exact: false, sub: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-[220px] md:flex-col md:fixed md:inset-y-0 bg-white border-r border-[#F2F4F6]">
      {/* 로고 */}
      <div className="flex items-center h-[60px] px-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center shadow-sm">
            <Warehouse className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-[15px] tracking-[-0.02em] text-foreground">셀러 ERP</span>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 px-3 pt-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-[10px] py-[9px] text-[13.5px] font-medium transition-all duration-100',
                item.sub ? 'pl-8 pr-3 text-[13px]' : 'px-3',
                isActive
                  ? 'bg-[#EBF1FE] text-primary'
                  : 'text-[#6B7684] hover:bg-[#F2F4F6] hover:text-foreground'
              )}
            >
              <item.icon
                className={cn(item.sub ? 'h-[15px] w-[15px]' : 'h-[17px] w-[17px]', 'shrink-0', isActive ? 'text-primary' : 'text-[#B0B8C1]')}
                strokeWidth={isActive ? 2.5 : 2}
              />
              {item.title}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4">
        <p className="text-[11px] text-[#B0B8C1]">v1.0 · ERP</p>
      </div>
    </aside>
  );
}
