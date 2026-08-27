import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode; // 우측 액션 버튼
  className?: string;
}

/**
 * 페이지 제목 — 모든 페이지 공통. 20px / 700 / -0.03em, 페이지당 1개(h1).
 * 우측 children 은 액션 버튼 영역.
 */
export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold tracking-[-0.03em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-[12px] text-fg-3">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

interface SectionTitleProps {
  title: React.ReactNode;
  count?: number | string;
  children?: React.ReactNode;
  className?: string;
}

/** 카드/섹션 제목 — 15px / 700 / -0.02em. */
export function SectionTitle({ title, count, children, className }: SectionTitleProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-bold tracking-[-0.02em] text-fg">
        {title}
        {count !== undefined && <span className="ml-1.5 text-[12px] font-medium text-fg-4">{count}</span>}
      </h2>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}
