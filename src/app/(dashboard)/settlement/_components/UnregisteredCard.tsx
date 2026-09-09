'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { fmtNum } from '../_lib/settlement';

interface Item { vendorItemId: string; name: string; sources: string[]; adCost: number; suggestedSkuId: string | null }
interface NameOnly { platform: string; name: string; qty: number; revenue: number }
interface Sku { id: string; code: string; name: string; productId: string | null }

/**
 * 등록 필요 큐 — RG API·광고 raw·매출 파일에 나타났지만 마스터에 없는 쿠팡 옵션ID.
 * 여기서 SKU 연결·판매가·수수료율만 넣으면 platform_skus 에 등록되고 다음 집계부터 자동 매칭된다.
 */
export function UnregisteredCard({ selectedYm, onRegistered }: { selectedYm: string; onRegistered?: () => void }) {
  const [data, setData] = useState<{ coupangChannelId: string | null; items: Item[]; nameOnly: NameOnly[]; skus: Sku[] } | null>(null);
  const [form, setForm] = useState<Record<string, { skuId: string; price: string; rate: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const toast = useToast();

  const load = useCallback(() => {
    fetch(`/api/settlement/unregistered?year_month=${selectedYm}`).then(r => r.json()).then(j => {
      setData(j);
      const f: Record<string, { skuId: string; price: string; rate: string }> = {};
      for (const it of j.items ?? []) f[it.vendorItemId] = { skuId: it.suggestedSkuId ?? '', price: '', rate: '' };
      setForm(f);
    }).catch(() => setData(null));
  }, [selectedYm]);
  useEffect(() => { load(); }, [load]);

  async function register(it: Item) {
    const f = form[it.vendorItemId];
    if (!f?.skuId) { toast.warning('연결할 SKU 를 고르세요'); return; }
    if (!data?.coupangChannelId) { toast.error('쿠팡 채널이 설정에 없습니다'); return; }
    setBusy(it.vendorItemId);
    try {
      const body: any = { sku_id: f.skuId, channel_id: data.coupangChannelId, platform_sku_id: it.vendorItemId, platform_product_name: it.name || null, is_active: true };
      if (f.price) body.price = Number(f.price.replace(/[^0-9]/g, ''));
      if (f.rate) body.commission_rate = Number(f.rate);
      const r = await fetch('/api/platform-skus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(`등록 실패: ${j.error ?? r.status}`); return; }
      toast.success(`${it.vendorItemId} 등록 — 다음 집계부터 자동 매칭됩니다`);
      load(); onRegistered?.();
    } finally { setBusy(null); }
  }

  const [showRgOnly, setShowRgOnly] = useState(false);
  if (!data) return null;
  const active = data.items.filter(it => it.sources.some(s => s !== 'RG API'));   // 이번 달 광고·매출에 실제로 나온 옵션
  const rgOnly = data.items.filter(it => !it.sources.some(s => s !== 'RG API'));   // RG 재고에만 있는 옵션 (신규 입고 등)
  const n = active.length + data.nameOnly.length;
  if (n === 0 && rgOnly.length === 0) return null;

  return (
    <section className="rounded-2xl border border-warn/40 bg-warn/5 px-4 md:px-5 py-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <AlertTriangle className="h-4 w-4 text-warn shrink-0" />
        <span className="text-[13px] font-bold text-fg">등록 필요 {n}건</span>
        <span className="text-[12px] text-fg-3">이번 달 광고·매출에 나온 미등록 옵션ID {active.length} · 이름 매칭 실패 {data.nameOnly.length}{rgOnly.length ? ` · RG 재고에만 있는 옵션 ${rgOnly.length}` : ''}. 등록하지 않으면 상품별 순이익에서 빠집니다.</span>
        <span className="ml-auto text-[11px] text-fg-4">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {[...active, ...(showRgOnly ? rgOnly : [])].map(it => {
            const f = form[it.vendorItemId] ?? { skuId: '', price: '', rate: '' };
            const set = (p: Partial<typeof f>) => setForm(prev => ({ ...prev, [it.vendorItemId]: { ...f, ...p } }));
            return (
              <div key={it.vendorItemId} className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2 border border-line">
                <code className="text-[11px] bg-app px-1.5 py-0.5 rounded border border-line">{it.vendorItemId}</code>
                <span className="text-[12px] text-fg truncate max-w-[260px]" title={it.name}>{it.name || '(상품명 없음)'}</span>
                <span className="text-[10px] text-fg-4">{it.sources.join(' · ')}{it.adCost ? ` · 광고비 ${fmtNum(it.adCost)}원` : ''}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <select value={f.skuId} onChange={e => set({ skuId: e.target.value })} className={cn(inputClassName, 'h-7 w-56 text-[12px]')}>
                    <option value="">SKU 연결…</option>
                    {data.skus.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                  </select>
                  <input value={f.price} onChange={e => set({ price: e.target.value })} placeholder="판매가" inputMode="numeric" className={cn(inputClassName, 'h-7 w-24 text-[12px] text-right')} />
                  <input value={f.rate} onChange={e => set({ rate: e.target.value })} placeholder="수수료%" inputMode="decimal" className={cn(inputClassName, 'h-7 w-20 text-[12px] text-right')} />
                  <Button size="sm" onClick={() => register(it)} disabled={busy === it.vendorItemId}>{busy === it.vendorItemId ? <Loader2 className="animate-spin" /> : '등록'}</Button>
                </div>
              </div>
            );
          })}
          {rgOnly.length > 0 && (
            <button onClick={() => setShowRgOnly(v => !v)} className="text-[11px] text-fg-4 hover:text-brand">{showRgOnly ? 'RG 재고 전용 옵션 접기' : `RG 재고에만 있는 옵션 ${rgOnly.length}개 보기 (새로 입고됐거나 판매 중단된 옵션)`}</button>
          )}
          {data.nameOnly.length > 0 && (
            <div className="rounded-xl bg-card px-3 py-2 border border-line text-[12px] text-fg-2">
              <div className="font-semibold text-fg mb-1">매출 파일에서 상품을 못 찾은 행 {data.nameOnly.length}</div>
              <ul className="space-y-0.5">
                {data.nameOnly.slice(0, 8).map((r, i) => <li key={i} className="flex gap-2 tabular-nums"><span className="text-fg-4 w-14 shrink-0">{r.platform}</span><span className="truncate" title={r.name}>{r.name}</span><span className="ml-auto shrink-0 text-fg-3">{r.qty}개 · {fmtNum(r.revenue)}원</span></li>)}
              </ul>
              <p className="mt-1.5 text-[11px] text-fg-4">토스·스스는 옵션ID 가 없어 이름으로 찾습니다. <Link href="/master" className="text-brand hover:underline">마스터 시트</Link>에서 해당 채널 상품명·상품번호를 넣거나, 매입원가 업로드에서 단가를 한 번 적어 두면 다음부터 잡힙니다.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
