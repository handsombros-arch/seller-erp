'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { fmtNum, fmtPct, lastMonths, type Market } from '../_lib/settlement';
import { allocateSheetMarketing, buildPsMap, computeProductLines, type AdRowLite, type PlatformSkuLite, type ProductLine, type SalesRowLite } from '../_lib/productProfit';

type Metric = 'contribution' | 'revenue' | 'ad' | 'margin' | 'roas';
const METRICS = [{ value: 'contribution', label: '공헌이익' }, { value: 'revenue', label: '매출' }, { value: 'ad', label: '광고·마케팅' }, { value: 'margin', label: '마진율' }, { value: 'roas', label: 'ROAS' }] as const;

/** 상품 × 월 매트릭스 — 상품별 순이익 탭의 "월별 추이" 보기 */
export function ProductTrend({ ym, market, sheetMarketingByMonth }: { ym: string; market: 'all' | Market; sheetMarketingByMonth?: (ym: string) => Partial<Record<Market, number>> }) {
  const months = useMemo(() => { const [y, m] = ym.split('-').map(Number); return lastMonths(12, new Date(y, m - 1, 1)).reverse(); }, [ym]);
  const [metric, setMetric] = useState<Metric>('contribution');
  const [loading, setLoading] = useState(true);
  const [byMonth, setByMonth] = useState<Map<string, ProductLine[]>>(new Map());

  useEffect(() => {
    let cancelled = false; setLoading(true);
    (async () => {
      const [salesAll, pskus] = await Promise.all([
        fetch('/api/monthly-product-sales').then(r => r.ok ? r.json() : []) as Promise<(SalesRowLite & { year_month: string })[]>,
        fetch('/api/platform-skus').then(r => r.ok ? r.json() : []) as Promise<PlatformSkuLite[]>,
      ]);
      const psMap = buildPsMap(Array.isArray(pskus) ? pskus : []);
      const salesBy = new Map<string, SalesRowLite[]>();
      for (const s of Array.isArray(salesAll) ? salesAll : []) { const a = salesBy.get(s.year_month) ?? []; a.push(s); salesBy.set(s.year_month, a); }
      const ads = await Promise.all(months.map(async m => {
        const [c, t] = await Promise.all([
          fetch(`/api/settlement/product-ads?year_month=${m}`).then(r => r.json()).catch(() => null),
          fetch(`/api/settlement/product-ads?year_month=${m}&platform=toss`).then(r => r.json()).catch(() => null),
        ]);
        return [m, (c?.products ?? []) as AdRowLite[], (t?.products ?? []) as AdRowLite[]] as const;
      }));
      if (cancelled) return;
      const out = new Map<string, ProductLine[]>();
      for (const [m, c, t] of ads) { const s = salesBy.get(m) ?? []; if (!s.length && !c.length && !t.length) continue; const lines = computeProductLines(s, c, t, psMap); allocateSheetMarketing(lines, sheetMarketingByMonth?.(m)); out.set(m, lines); }
      setByMonth(out); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [months, sheetMarketingByMonth]);

  const rows = useMemo(() => {
    const prod = new Map<string, { name: string; cells: Map<string, ProductLine[]>; total: number }>();
    for (const [m, lines] of byMonth) for (const l of lines) {
      if (market !== 'all' && l.market !== market) continue;
      const key = l.productId ?? `__${l.productName}`;
      let p = prod.get(key); if (!p) { p = { name: l.productName, cells: new Map(), total: 0 }; prod.set(key, p); }
      const arr = p.cells.get(m) ?? []; arr.push(l); p.cells.set(m, arr);
    }
    const val = (ls: ProductLine[] | undefined): number | null => {
      if (!ls?.length) return null;
      const s = ls.reduce((a, l) => ({ rev: a.rev + l.revenue, contrib: a.contrib + l.contribution, ad: a.ad + l.ad + l.marketing }), { rev: 0, contrib: 0, ad: 0 });
      if (metric === 'contribution') return s.contrib; if (metric === 'revenue') return s.rev; if (metric === 'ad') return s.ad;
      if (metric === 'margin') return s.rev ? (s.contrib / s.rev) * 100 : null;
      return s.ad ? (s.rev / s.ad) * 100 : null;
    };
    const list = [...prod.values()].map(p => { const cells = months.map(m => val(p.cells.get(m))); const total = cells.reduce((a: number, v) => a + (v ?? 0), 0); return { name: p.name, cells, total }; });
    return list.sort((a, b) => b.total - a.total);
  }, [byMonth, market, metric, months]);

  const isPct = metric === 'margin' || metric === 'roas';
  const fmt = (v: number | null) => v == null ? '' : isPct ? fmtPct(v, 0) : fmtNum(v);
  const cls = (v: number | null) => v == null ? 'text-fg-5' : metric === 'contribution' ? (v < 0 ? 'text-danger font-semibold' : 'text-fg') : metric === 'margin' ? (v < 0 ? 'text-danger' : v < 10 ? 'text-warn' : 'text-fg') : 'text-fg';
  const activeMonths = months.filter(m => byMonth.has(m));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-fg-3 mr-auto">최근 12개월 · 매출 파일과 광고 집계가 저장된 달만 표시됩니다. 값은 마켓 정책(수수료·물류)과 광고 raw 기준 추정입니다.</span>
        <SegmentedControl items={METRICS} value={metric} onChange={setMetric} />
      </div>
      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div> : rows.length === 0 ? (
        <p className="text-[13px] text-fg-4 py-8 text-center">표시할 상품 데이터가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[12px] border-collapse min-w-[900px]">
            <thead><tr className="h-9 border-b border-line text-[11px] font-semibold text-fg-4 bg-card-2">
              <th className="text-left px-3 sticky left-0 bg-card-2 min-w-[180px]">상품</th>
              {activeMonths.map(m => <th key={m} className={cn('text-right px-2 tabular-nums', m === ym && 'text-brand')}>{m.slice(2).replace('-', '.')}</th>)}
              {!isPct && <th className="text-right px-3">합계</th>}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.name} className="border-b border-line-2 h-9">
                  <td className="px-3 sticky left-0 bg-card truncate max-w-[220px]" title={r.name}>{r.name}</td>
                  {activeMonths.map((m, i) => { const v = r.cells[months.indexOf(m)]; return <td key={m} className={cn('px-2 text-right tabular-nums', cls(v), m === ym && 'bg-brand-soft')}>{fmt(v)}</td>; })}
                  {!isPct && <td className={cn('px-3 text-right tabular-nums font-semibold', r.total < 0 && metric === 'contribution' ? 'text-danger' : 'text-fg')}>{fmtNum(r.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
