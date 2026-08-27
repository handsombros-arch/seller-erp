'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 삭제·초기화 등 되돌릴 수 없는 작업 — 빨간 확인 버튼 */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** 네이티브 confirm() 대체 — `const confirm = useConfirm(); if (!(await confirm('삭제할까요?'))) return;` */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((raw) => {
    const opts: ConfirmOptions = typeof raw === 'string' ? splitMessage(raw) : raw;
    return new Promise<boolean>((resolve) => setState({ opts, resolve }));
  }, []);

  const close = useCallback((v: boolean) => {
    setState((s) => { s?.resolve(v); return null; });
  }, []);

  useEffect(() => {
    if (!state) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-[400px] rounded-2xl bg-card p-6 shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
            <div className="flex items-start gap-3">
              {state.opts.destructive && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/10">
                  <AlertTriangle className="h-[18px] w-[18px] text-danger" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold tracking-[-0.02em] text-fg">{state.opts.title}</h2>
                {state.opts.description && (
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-fg-3">{state.opts.description}</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>{state.opts.cancelText ?? '취소'}</Button>
              <Button
                ref={confirmBtn}
                onClick={() => close(true)}
                className={cn(state.opts.destructive && 'bg-danger text-white hover:bg-danger/90')}
              >
                {state.opts.confirmText ?? (state.opts.destructive ? '삭제' : '확인')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** "제목\n설명" 형태의 문자열을 title/description 으로 분리. 삭제·초기화 문구면 destructive. */
function splitMessage(msg: string): ConfirmOptions {
  const [title, ...rest] = msg.split('\n');
  const destructive = /삭제|초기화|되돌릴 수 없/.test(msg);
  return { title: title.trim(), description: rest.join('\n').trim() || undefined, destructive, confirmText: destructive ? (/초기화/.test(title) ? '초기화' : '삭제') : undefined };
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
