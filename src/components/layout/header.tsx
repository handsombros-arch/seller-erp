'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useVat } from '@/components/layout/vat-provider';
import { useWide } from '@/components/layout/wide-provider';
import { LVLogoText } from '@/components/ui/lv-logo';
import { PresenceIndicator } from '@/components/layout/presence';
import { DeployStatus } from '@/components/layout/deploy-status';
import { navItems, navSections, isNavActive, currentNavItem } from '@/config/nav';
import { useState } from 'react';
import { Menu, LogOut, Settings, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

export function Header({ email, deployedSha }: { email?: string; deployedSha?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { vatOn, toggleVat } = useVat();
  const { wide, toggle: toggleWide } = useWide();
  const [spinning, setSpinning] = useState(false);

  const currentPage = currentNavItem(pathname);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleRefresh = () => {
    setSpinning(true);
    router.refresh();
    setTimeout(() => setSpinning(false), 1000);
  };

  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    <header
      className="sticky top-0 z-40 h-14 backdrop-blur-xl"
      style={{ backgroundColor: 'var(--bg-header)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="flex h-full items-center justify-between px-5 md:px-6">
        <div className="flex items-center gap-3">
          {/* 모바일 메뉴 — 사이드바와 같은 nav 설정 사용 */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className={cn('rounded-xl', !wide && 'md:hidden')} title="메뉴">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[220px] p-0"
              style={{ backgroundColor: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center h-14 px-4">
                <LVLogoText size={28} />
              </div>
              <nav className="px-2.5 pt-1">
                {navSections.map(({ key, label }) => {
                  const items = navItems.filter((i) => i.section === key);
                  if (!items.length) return null;
                  return (
                    <div key={key} className={label ? 'mt-4' : ''}>
                      {label && (
                        <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-5">{label}</p>
                      )}
                      {items.map((item) => {
                        const isActive = isNavActive(item, pathname);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                              'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors',
                              isActive ? 'bg-brand-bg text-brand' : 'text-fg-2 hover:bg-[var(--bg-hover)]',
                            )}
                          >
                            <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand' : 'text-fg-4')} />
                            {item.title}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>

          <p className="text-[15px] font-semibold tracking-[-0.02em] text-fg">
            {currentPage?.title ?? 'LV ERP'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <DeployStatus deployedSha={deployedSha} />
          <PresenceIndicator currentEmail={email} />

          <Button
            variant={wide ? 'default' : 'outline'}
            size="icon"
            onClick={toggleWide}
            title={wide ? '넓게 보기 끄기 (사이드바 표시)' : '넓게 보기 (사이드바 숨기고 표를 화면 폭에 맞춤)'}
            className="rounded-[10px] hidden md:inline-flex"
          >
            {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            title="페이지 데이터 새로고침"
            className="rounded-[10px]"
          >
            <RefreshCw className={cn('h-4 w-4 transition-transform', spinning && 'animate-spin')} />
          </Button>

          <Button
            variant={vatOn ? 'default' : 'outline'}
            size="sm"
            onClick={toggleVat}
            title={vatOn ? '부가세 포함 표시 중 (클릭 시 별도로 변경)' : '원가·물류비는 부가세 별도 금액입니다 (클릭 시 포함으로 변경)'}
          >
            {vatOn ? 'VAT 포함' : 'VAT 별도'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full bg-brand-bg flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
                <span className="text-[13px] font-semibold text-brand">{initials}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg border-line bg-card">
              <div className="px-3 py-2 border-b border-line-2">
                <p className="text-[12px] text-fg-3 truncate">{email ?? '사용자'}</p>
              </div>
              <DropdownMenuItem asChild className="rounded-lg mx-1 mt-1">
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4 text-fg-3" />
                  <span className="text-[13px]">설정</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSignOut} className="rounded-lg mx-1 mb-1 text-danger focus:text-danger">
                <LogOut className="mr-2 h-4 w-4" />
                <span className="text-[13px]">로그아웃</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
