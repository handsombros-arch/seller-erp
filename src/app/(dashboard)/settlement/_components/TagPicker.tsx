'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ALLOC_RULES, MARKETS, PL_LINES, effectiveTags, marketLabel, plLineLabel, type MCost } from '../_lib/settlement';

/**
 * 말단 항목의 손익 라인 · 마켓 · 배분 규칙 칩.
 * 명시값이 없으면 라벨로 추론한 값을 점선 칩으로 보여주고, 클릭해 확정한다.
 */
export function TagPicker({ item, parent, onChange }: { item: MCost; parent: MCost | null; onChange: (patch: Partial<MCost>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tags = effectiveTags(item, parent);
  const isCommon = tags.market === 'common';

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open]);

  const sel = 'h-7 w-full rounded-lg border border-line bg-card px-2 text-[12px] text-fg focus:outline-none focus:border-brand';

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        title={tags.inferred ? '라벨로 추론한 분류입니다. 클릭해서 확정하세요.' : '분류 · 마켓 (클릭해서 변경)'}
        className={cn(
          'h-6 max-w-full px-2 rounded-md text-[10px] font-semibold whitespace-nowrap truncate transition-colors',
          tags.inferred
            ? 'border border-dashed border-fg-5 text-fg-4 hover:border-brand hover:text-brand'
            : 'bg-brand-bg text-brand hover:bg-brand-bg/70',
        )}>
        {plLineLabel(tags.pl_line)} · {marketLabel(tags.market)}
        {isCommon && tags.alloc_rule !== 'none' && ` · ${ALLOC_RULES.find(a => a.id === tags.alloc_rule)?.label}`}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-line bg-card shadow-lg p-3 space-y-2 text-left">
          <div>
            <label className="block text-[10px] font-semibold text-fg-4 mb-1">손익 라인</label>
            <select className={sel} value={tags.pl_line} onChange={(e) => onChange({ pl_line: e.target.value as MCost['pl_line'] })}>
              {PL_LINES.map(l => <option key={l.id} value={l.id}>{l.label} — {l.hint}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-fg-4 mb-1">마켓</label>
            <select className={sel} value={tags.market} onChange={(e) => onChange({ market: e.target.value as MCost['market'] })}>
              {MARKETS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          {isCommon && (
            <div>
              <label className="block text-[10px] font-semibold text-fg-4 mb-1">공통 비용 배분</label>
              <select className={sel} value={tags.alloc_rule} onChange={(e) => onChange({ alloc_rule: e.target.value as MCost['alloc_rule'] })}>
                {ALLOC_RULES.map(a => <option key={a.id} value={a.id}>{a.label} — {a.hint}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <button type="button" className="text-[11px] text-fg-4 hover:text-fg" onClick={() => onChange({ pl_line: null, market: null, alloc_rule: null })}>추론값으로 되돌리기</button>
            <button type="button" className="text-[11px] font-semibold text-brand" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
