'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** 넓은 폼(표 포함 등) — max-w-2xl */
  wide?: boolean;
  className?: string;
}

/**
 * 앱 표준 모달 — 페이지별 로컬 `function Dialog` 대체.
 * Radix 기반: 포털·포커스 트랩·Esc·바깥 클릭 닫기·스크롤 잠금 포함.
 * 사용: <AppDialog open={open} onClose={() => setOpen(false)} title="공급처 추가">…</AppDialog>
 */
export function AppDialog({ open, onClose, title, description, children, wide, className }: AppDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 max-h-[90vh] overflow-y-auto rounded-2xl bg-card shadow-[0_8px_32px_rgba(0,0,0,0.12)] focus:outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-line-2">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-bold text-fg tracking-[-0.02em]">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[12px] text-fg-3">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-fg-3 hover:bg-app hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
