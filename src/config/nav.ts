import type { LucideIcon } from 'lucide-react';
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
  Search,
  TrendingUp,
  BarChart3,
} from 'lucide-react';

export type NavSection = 'main' | 'data' | 'ops' | 'sales' | 'etc';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  exact: boolean;
  section: NavSection;
}

/** 사이드바 · 모바일 메뉴 · 헤더 제목의 단일 출처. 여기만 고치면 세 곳이 함께 바뀐다. */
export const navItems: NavItem[] = [
  { title: '대시보드',    href: '/',              icon: LayoutDashboard, exact: true,  section: 'main' },
  { title: '마스터 시트', href: '/master',        icon: FileSpreadsheet, exact: false, section: 'main' },
  { title: '상품 관리',   href: '/products',      icon: Package,         exact: false, section: 'data' },
  { title: '공급처 관리', href: '/suppliers',     icon: Building2,       exact: false, section: 'data' },
  { title: '재고 관리',   href: '/inventory',     icon: Warehouse,       exact: false, section: 'ops' },
  { title: '입출고 관리', href: '/inbound',       icon: PackageCheck,    exact: false, section: 'ops' },
  { title: '채널 판매',   href: '/channel-sales', icon: ShoppingCart,    exact: false, section: 'sales' },
  { title: '광고 분석',   href: '/ad-analysis',   icon: Megaphone,       exact: false, section: 'sales' },
  { title: '가격 분석',   href: '/price-tool',    icon: Tag,             exact: false, section: 'sales' },
  { title: '소싱 분석',   href: '/sourcing',      icon: Search,          exact: false, section: 'sales' },
  { title: '순위 추적',   href: '/rank-tracking', icon: TrendingUp,      exact: false, section: 'sales' },
  { title: '데이터 분석', href: '/data-analysis', icon: BarChart3,       exact: false, section: 'sales' },
  { title: '정산',        href: '/settlement',    icon: Calculator,      exact: false, section: 'etc' },
  { title: '설정',        href: '/settings',      icon: Settings,        exact: false, section: 'etc' },
];

export const navSections: { key: NavSection; label: string }[] = [
  { key: 'main', label: '' },
  { key: 'data', label: '데이터' },
  { key: 'ops', label: '운영' },
  { key: 'sales', label: '판매' },
  { key: 'etc', label: '' },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function currentNavItem(pathname: string): NavItem | undefined {
  return navItems.find((i) => isNavActive(i, pathname));
}
