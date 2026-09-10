'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { fmtNum, ymLabel } from '../_lib/settlement';

/**
 * 빈박스(리뷰용 발송) 입력 — 이미 적용한 달의 매출 파일 행에 SKU 별 빈박스 개수만 적는다.
 * 저장하면 그 행의 원가 = 단가 × (수량 − 빈박스) 로 다시 계산되고, 재고가 그만큼 되돌아오며,
 * 시트 "빈박스 - 마켓" 기준값(Σ 빈박스 × 판매가)과 상품별 순이익(마케팅비)에 반영된다. 매출·택배비는 그대로.
 */
interface Row { id: string; platform: string; display_name: string; qty: number; empty_qty: number | null; unit_cost: number; revenue: number; sku?: { sku_code?: string; product?: { name?: string } | null } | null }

const PLATFORM_LABEL: Record<string, string> = { coupang: '쿠팡', toss: '토스', smartstore: '스스', esm: 'ESM' };

export function EmptyBoxCard({ selectedYm, closed, onSaved }: { selectedYm: string; closed?: boolean; onSaved?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/monthly-product-sales?year_month=${selectedYm}`);
      const j = await r.json();
      const list: Row[] = (Array.isArray(j) ? j : []).filter((x: Row) => !String(x.id).startsWith('b2b:'));
      setRows(list); setDraft({});
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [selectedYm]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const withEmpty = rows.filter(r => (Number(r.empty_qty) || 0) > 0);
  const totalEmpty = withEmpty.reduce((s, r) => s + (Number(r.empty_qty) || 0), 0);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    const base = k ? rows.filter(r => `${r.display_name} ${r.sku?.sku_code ?? ''} ${r.sku?.product?.name ?? ''}`.toLowerCase().includes(k)) : rows;
    return [...base].sort((a, b) => (Number(b.empty_qty) || 0) - (Number(a.empty_qty) || 0) || b.revenue - a.revenue).slice(0, k ? 50 : 30);
  }, [rows, q]);

  const save = async (r: Row) => {
    const v = Math.max(0, Number((draft[r.id] ?? '').replace(/[^0-9]/g, '')) || 0);
    if (v === (Number(r.empty_qty) || 0)) return;
    setSaving(r.id);
    try {
      const res = await fetch('/api/monthly-product-sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, empty_qty: v }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? '저장 실패'); return; }
      toast.success(`${r.display_name} 빈박스 ${v}개 저장${j.restored != null ? ` · 재고 되돌림 ${j.restored}개` : ''}`);
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, empty_qty: v } : x));
      setDraft(prev => { const n = { ...prev }; delete n[r.id]; return n; });
      onSaved?.();
    } finally { setSaving(null); }
  };

  return (
    <div className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 py-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-left">
        <PackageOpen className="h-4 w-4 text-warn shrink-0" />
        <span className="text-[13px] font-bold text-fg">빈박스 입력</span>
        <span className="text-[12px] text-fg-3">{ymLabel(selectedYm)} 리뷰용 빈박스 — 상품(SKU)과 개수만 적으면 원가 제외·재고 되돌림·빈박스 환불 기준값까지 자동{totalEmpty ? ` · 현재 ${withEmpty.length}건 ${totalEmpty}개` : ''}</span>
        <span className="ml-auto text-[11px] text-fg-4">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-fg-4">매출 파일을 적용한 행 기준입니다. 매출 파일 미리보기의 빈박스 열에 적어도 같고, 여기서는 적용 뒤에 고칠 수 있습니다. 매출·택배비는 그대로 두고 원가만 빠집니다.{closed ? ' 마감된 달은 수정할 수 없습니다.' : ''}</p>
          <input lang="ko" value={q} onChange={e => setQ(e.target.value)} placeholder="상품명 · SKU 검색" className={cn(inputClassName, 'h-8 w-72 text-[12px]')} />
          {loading ? <div className="py-4 text-center text-fg-4 text-[12px]"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />불러오는 중</div>
          : rows.length === 0 ? <div className="py-4 text-center text-fg-4 text-[12px]">이 달 적용된 매출 파일 행이 없습니다. 먼저 매출 파일을 올려 적용하세요.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-fg-4 text-[11px] border-b border-line-2">
                  <th className="text-left px-2 py-1.5 font-medium w-12">마켓</th>
                  <th className="text-left px-2 py-1.5 font-medium">상품 (파일 표시명)</th>
                  <th className="text-left px-2 py-1.5 font-medium w-40">SKU</th>
                  <th className="text-right px-2 py-1.5 font-medium w-16">판매</th>
                  <th className="text-right px-2 py-1.5 font-medium w-24">빈박스</th>
                  <th className="text-right px-2 py-1.5 font-medium w-28">원가(제외 후)</th>
                  <th className="w-16" />
                </tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const cur = Number(r.empty_qty) || 0;
                    const d = draft[r.id]; const val = d ?? (cur ? String(cur) : '');
                    const next = Math.max(0, Number((val || '0').replace(/[^0-9]/g, '')) || 0);
                    const changed = d != null && next !== cur;
                    return (
                      <tr key={r.id} className={cn('border-b border-line-2/60', cur > 0 && 'bg-warn/[0.05]')}>
                        <td className="px-2 py-1 text-fg-3">{PLATFORM_LABEL[r.platform] ?? r.platform}</td>
                        <td className="px-2 py-1 text-fg truncate max-w-[300px]" title={r.display_name}>{r.display_name}</td>
                        <td className="px-2 py-1 text-fg-4 truncate max-w-[160px]" title={r.sku?.product?.name ?? ''}>{r.sku?.sku_code ?? <span className="text-warn">미연결</span>}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.qty)}</td>
                        <td className="px-1 py-1"><input type="text" inputMode="numeric" disabled={!!closed || !r.sku} value={val} placeholder="0"
                          onChange={e => setDraft(prev => ({ ...prev, [r.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                          onKeyDown={e => { if (e.key === 'Enter') save(r); }}
                          className={cn(inputClassName, 'h-8 px-2 text-right text-[12px] tabular-nums w-full', next > r.qty && 'border-danger', cur > 0 && 'font-semibold text-warn')} /></td>
                        <td className="px-2 py-1 text-right tabular-nums text-fg-3">{fmtNum(Math.round((Number(r.unit_cost) || 0) * Math.max(0, r.qty - next)))}</td>
                        <td className="px-1 py-1 text-right">{changed && <Button size="sm" onClick={() => save(r)} disabled={saving === r.id || next > r.qty}>{saving === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '저장'}</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > filtered.length && !q && <p className="text-[11px] text-fg-4 mt-1">매출 상위 30행만 표시 — 나머지는 검색으로 찾으세요.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
