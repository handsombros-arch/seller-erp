'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; type: ToastType; message: string }
interface ToastOptions { duration?: number }

interface ToastApi {
  /** 기본 = success */
  (message: string, opts?: ToastOptions): void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastType, React.ElementType> = {
  success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle,
};
const ICON_COLOR: Record<ToastType, string> = {
  success: 'text-green-400', error: 'text-red-400', info: 'text-sky-300', warning: 'text-amber-300',
};

/** 앱 공통 토스트 — 하단 중앙, 3초 자동 닫힘(에러·경고는 6초), 여러 개 쌓임. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback((type: ToastType, message: string, opts?: ToastOptions) => {
    if (!message) return;
    const id = ++seq.current;
    setItems((prev) => [...prev.slice(-3), { id, type, message }]);
    const duration = opts?.duration ?? (type === 'error' || type === 'warning' ? 6000 : 3000);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => {
    const fn = ((m: string, o?: ToastOptions) => push('success', m, o)) as ToastApi;
    fn.success = (m, o) => push('success', m, o);
    fn.error = (m, o) => push('error', m, o);
    fn.info = (m, o) => push('info', m, o);
    fn.warning = (m, o) => push('warning', m, o);
    return fn;
  }, [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => {
          const Icon = ICON[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-2xl bg-fg px-4 py-3 text-[13px] font-medium text-white shadow-lg whitespace-pre-line"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_COLOR[t.type])} />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="ml-1 rounded-md p-0.5 text-white/60 hover:text-white" aria-label="닫기">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
