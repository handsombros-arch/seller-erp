import { Package } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  children?: React.ReactNode; // 액션 버튼
}

export function EmptyState({ icon: Icon = Package, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Icon className="h-10 w-10 text-fg-5 mb-3" />
      <p className="text-[13px] font-medium text-fg-3">{title}</p>
      {description && <p className="text-[11px] text-fg-5 mt-1">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
