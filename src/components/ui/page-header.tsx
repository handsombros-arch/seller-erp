interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode; // 우측 액션 버튼
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.03em] text-[#191F28]">{title}</h2>
        {description && <p className="mt-1 text-[12px] text-[#6B7684]">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}
