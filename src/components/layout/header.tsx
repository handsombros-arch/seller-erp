'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutDashboard, Package, Warehouse, PackageCheck,
  PackageMinus, TrendingUp, FileSpreadsheet, Settings, Menu, LogOut, CalendarDays, Building2, ShoppingCart,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const navItems = [
  { title: '대시보드',    href: '/',          icon: LayoutDashboard, exact: true },
  { title: '마스터 시트', href: '/master',    icon: FileSpreadsheet, exact: false },
  { title: '상품 관리',   href: '/products',  icon: Package,         exact: false },
  { title: '재고 현황',   href: '/inventory', icon: Warehouse,       exact: false },
  { title: '입고 관리',   href: '/inbound',   icon: PackageCheck,    exact: false },
  { title: '출고 기록',    href: '/outbound',       icon: PackageMinus,  exact: false },
  { title: '공급처 관리',  href: '/suppliers',      icon: Building2,     exact: false },
  { title: '채널 판매',    href: '/channel-sales',  icon: ShoppingCart,  exact: false },
  { title: '재고 예측',    href: '/forecast',       icon: TrendingUp,    exact: false },
  { title: '입출고 캘린더', href: '/calendar',      icon: CalendarDays,  exact: false },
  { title: '설정',         href: '/settings',  icon: Settings,        exact: false },
];

export function Header({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const currentPage = navItems.find((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    <header className="sticky top-0 z-40 h-[60px] bg-white border-b border-[#F2F4F6]">
      <div className="flex h-full items-center justify-between px-5 md:px-6">
        <div className="flex items-center gap-3">
          {/* 모바일 메뉴 */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 rounded-xl">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[220px] p-0 bg-white border-r border-[#F2F4F6]">
              <div className="flex items-center h-[60px] px-5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center">
                    <Warehouse className="h-4 w-4 text-white" strokeWidth={2.5} />
                  </div>
                  <span className="font-bold text-[15px] tracking-tight">셀러 ERP</span>
                </div>
              </div>
              <nav className="px-3 pt-2 space-y-0.5">
                {navItems.map((item) => {
                  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  return (
                    <Link key={item.href} href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-[10px] px-3 py-[9px] text-[13.5px] font-medium transition-all',
                        isActive ? 'bg-[#EBF1FE] text-primary' : 'text-[#6B7684] hover:bg-[#F2F4F6]'
                      )}>
                      <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-[#B0B8C1]')} />
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>

          <h1 className="text-[15px] font-semibold text-foreground tracking-[-0.02em]">
            {currentPage?.title ?? '대시보드'}
          </h1>
        </div>

        {/* 유저 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 w-9 rounded-full p-0">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-[13px] font-semibold text-primary">{initials}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg border-[#F2F4F6]">
            <div className="px-3 py-2 border-b border-[#F2F4F6]">
              <p className="text-[12px] text-muted-foreground truncate">{email ?? '사용자'}</p>
            </div>
            <DropdownMenuItem asChild className="rounded-lg mx-1 mt-1">
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="text-[13px]">설정</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="rounded-lg mx-1 mb-1 text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span className="text-[13px]">로그아웃</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
