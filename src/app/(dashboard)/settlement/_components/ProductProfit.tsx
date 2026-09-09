'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { MARKETS, MARKET_POLICY, SALES_MARKETS, fmtNum, fmtPct, isOversize, type Market, type MarketPL } from '../_lib/settlement';

interface SalesRow {
  id: string; year_month: string; platform: string; sku_id: string | null; display_name: string;
  qty: number; revenue: number; unit_cost: number; total_cost: number; match_method: string; empty_qty?: number;
  sku?: { id: string; sku_code: string; cost_price: number; product?: { id: string; name: string; logistics_tier: string | null } | null } | null;
}
interface AdRow { vendorItemId: string; name: string; cost: number; clicks: number; impressions: number; convQty14d: number; convRev14d: number; skuId: string | null; productId: string | null; productName: string | null; matched: boolean }
interface AdResp { yearMonth: string; totalCost: number; matchedCost: number; unmatchedCost: number; products: AdRow[]; needsMigration?: boolean; error?: string }
interface PlatformSku { sku_id: string; platform_sku_id: string | null; price: number | null; commission_rate: number | null; channel?: { type: string } | null }

interface Line {
  market: Market; productId: string | null; productName: string; tier: string | null;
  qty: number; revenue: number; cogs: number; fee: number; feeRate: number; feeDefault: boolean;
  logistics: number; ad: number; masterPriceQty: number; masterPriceSum: number;
}
interface Agg extends Omit<Line, 'market'> {
  key: string; markets: Market[]; lines: Line[];
  contribution: number; margin: number | null; roas: number | null; beRoas: number | null; preAdRate: number | null;
}

const won = (n: number) => fmtNum(n);

/** 상품별 순이익 — 마켓별 · 통합. 매출/원가는 업로드 실적, 수수료·물류는 상품 정책값, 광고비는 광고분석 raw 집계. */
export function ProductProfit({ ym, sheetMarkets }: { ym: string; sheetMarkets?: MarketPL[] }) {
  const [view, setView] = useState<'all' | Market>('all');
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [ads, setAds] = useState<AdResp | null>(null);
  const [pskus, setPskus] = useState<PlatformSku[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState(false); // 상세 열(수량·평균단가·물류·광고 전·손익분기) 표시

  const [adsLoading, setAdsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [s, p] = await Promise.all([
        fetch(`/api/monthly-product-sales?year_month=${ym}`).then(r => r.ok ? r.json() : []),
        fetch('/api/platform-skus').then(r => r.ok ? r.json() : []),
      ]);
      if (cancelled) return;
      setSales(Array.isArray(s) ? s : []);
      setPskus(Array.isArray(p) ? p : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ym]);
  // 광고 raw 집계는 느릴 수 있어(수십만 행) 별도로 — 표는 먼저 뜨고 광고비 열만 나중에 채워진다
  useEffect(() => {
    let cancelled = false;
    setAds(null); setAdsLoading(true);
    fetch(`/api/settlement/product-ads?year_month=${ym}`).then(r => r.json()).catch(() => ({ error: '광고 집계 실패', products: [] }))
      .then(a => { if (!cancelled) { setAds(a); setAdsLoading(false); } });
    return () => { cancelled = true; };
  }, [ym]);

  const psMap = useMemo(() => {
    const m = new Map<string, PlatformSku>();
    for (const p of pskus) if (p.channel?.type) m.set(`${p.channel.type}|${p.sku_id}`, p);
    return m;
  }, [pskus]);

  const { lines, unmatchedAds } = useMemo(() => {
    const lines: Line[] = [];
    const byKey = new Map<string, Line>();
    const get = (market: Market, productId: string | null, name: string, tier: string | null) => {
      const key = `${market}|${productId ?? '__' + name}`;
      let l = byKey.get(key);
      if (!l) { l = { market, productId, productName: name, tier, qty: 0, revenue: 0, cogs: 0, fee: 0, feeRate: 0, feeDefault: false, logistics: 0, ad: 0, masterPriceQty: 0, masterPriceSum: 0 }; byKey.set(key, l); lines.push(l); }
      return l;
    };
    for (const s of sales) {
      const market = (SALES_MARKETS.includes(s.platform as Market) ? s.platform : 'common') as Market;
      const pid = s.sku?.product?.id ?? null;
      const name = s.sku?.product?.name ?? s.display_name;
      const l = get(market, pid, name, s.sku?.product?.logistics_tier ?? null);
      const qty = Number(s.qty) || 0;
      const empty = Number(s.empty_qty) || 0;
      const rev = Number(s.revenue) || 0;
      l.qty += qty;
      l.revenue += rev;
      l.cogs += empty > 0 && qty > 0 ? Number(s.total_cost) * ((qty - empty) / qty) : Number(s.total_cost) || 0;
      const policy = MARKET_POLICY[market];
      const ps = s.sku_id ? psMap.get(`${market}|${s.sku_id}`) : undefined;
      const rate = ps?.commission_rate != null && Number(ps.commission_rate) > 0 ? Number(ps.commission_rate) / 100 : policy.feeRate;
      if (!(ps?.commission_rate != null && Number(ps.commission_rate) > 0)) l.feeDefault = true;
      l.fee += rev * rate;
      const perUnit = market === 'coupang' ? (isOversize(name, l.tier) ? (policy.oversizePerUnit ?? policy.shipPerUnit) : policy.shipPerUnit) : policy.shipPerUnit;
      l.logistics += qty * perUnit;
      if (ps?.price && Number(ps.price) > 0) { l.masterPriceQty += qty; l.masterPriceSum += Number(ps.price) * qty; }
    }
    for (const l of lines) l.feeRate = l.revenue > 0 ? l.fee / l.revenue : 0;
    const unmatchedAds: AdRow[] = [];
    for (const a of ads?.products ?? []) {
      if (a.productId) get('coupang', a.productId, a.productName ?? a.name, null).ad += a.cost;
      else if (a.cost > 0) unmatchedAds.push(a);
    }
    return { lines, unmatchedAds };
  }, [sales, ads, psMap]);

  const rows = useMemo<Agg[]>(() => {
    const filtered = view === 'all' ? lines : lines.filter(l => l.market === view);
    const byProduct = new Map<string, Agg>();
    for (const l of filtered) {
      const key = l.productId ?? `__${l.productName}`;
      let a = byProduct.get(key);
      if (!a) { a = { key, markets: [], lines: [], productId: l.productId, productName: l.productName, tier: l.tier, qty: 0, revenue: 0, cogs: 0, fee: 0, feeRate: 0, feeDefault: false, logistics: 0, ad: 0, masterPriceQty: 0, masterPriceSum: 0, contribution: 0, margin: null, roas: null, beRoas: null, preAdRate: null }; byProduct.set(key, a); }
      a.lines.push(l); if (!a.markets.includes(l.market)) a.markets.push(l.market);
      a.qty += l.qty; a.revenue += l.revenue; a.cogs += l.cogs; a.fee += l.fee; a.logistics += l.logistics; a.ad += l.ad;
      a.masterPriceQty += l.masterPriceQty; a.masterPriceSum += l.masterPriceSum; a.feeDefault = a.feeDefault || l.feeDefault;
    }
    const out = [...byProduct.values()].map(a => finish(a));
    return out.sort((x, y) => y.revenue - x.revenue);
  }, [lines, view]);

  const totals = useMemo(() => finish({ key: 'total', markets: [], lines: [], productId: null, productName: '합계', tier: null, feeRate: 0, feeDefault: false, masterPriceQty: 0, masterPriceSum: 0, contribution: 0, margin: null, roas: null, beRoas: null, preAdRate: null,
    qty: rows.reduce((s, r) => s + r.qty, 0), revenue: rows.reduce((s, r) => s + r.revenue, 0), cogs: rows.reduce((s, r) => s + r.cogs, 0), fee: rows.reduce((s, r) => s + r.fee, 0), logistics: rows.reduce((s, r) => s + r.logistics, 0), ad: rows.reduce((s, r) => s + r.ad, 0) }), [rows]);

  const marketsWithData = SALES_MARKETS.filter(m => lines.some(l => l.market === m));
  const viewItems = [{ value: 'all' as const, label: '통합' }, ...SALES_MARKETS.filter(m => m !== 'talkdeal').map(m => ({ value: m, label: MARKETS.find(x => x.id === m)!.short, disabled: !marketsWithData.includes(m) }))];
  const sheet = view !== 'all' ? sheetMarkets?.find(m => m.market === view) : null;

  return (
    <div className="space-y-4">
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 md:px-5 py-3 border-b border-line-2">
          <div className="mr-auto">
            <h3 className="text-[15px] font-bold text-fg">상품별 순이익 <span className="text-[11px] font-medium text-fg-4">{ym.replace('-', '.')} · VAT 포함 실거래가</span></h3>
            <p className="text-[11px] text-fg-4 mt-0.5">매출·원가는 업로드한 파일 실적, 수수료·물류비는 상품 정책값, 광고비는 광고분석 raw 집계입니다.</p>
          </div>
          <SegmentedControl items={viewItems} value={view} onChange={setView} />
          <label className="flex items-center gap-1.5 text-[12px] text-fg-3 cursor-pointer select-none"><input type="checkbox" className="accent-brand" checked={detail} onChange={e => setDetail(e.target.checked)} /> 상세 열</label>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-fg-4 text-center">
            {ym.replace('-', '.')} 상품별 매출 데이터가 없습니다. <Link href="/settlement?tab=input" className="text-brand font-semibold hover:underline">입력 탭</Link>에서 마켓 매출 파일을 올리고 "정산시트에 적용"을 누르면 생성됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full text-[12px] border-collapse', detail ? 'min-w-[1180px]' : 'min-w-[760px]')}>
              <thead>
                <tr className="h-9 border-b border-line text-[11px] font-semibold text-fg-4">
                  <th className="text-left px-4 min-w-[200px]">상품</th>
                  {view === 'all' && <th className="text-left px-2">마켓</th>}
                  {detail && <th className="text-right px-2">수량</th>}
                  <th className="text-right px-2">매출</th>
                  {detail && <th className="text-right px-2" title="실현 평균단가 · 괄호는 마스터 판매가 대비">평균단가</th>}
                  <th className="text-right px-2">원가</th>
                  <th className="text-right px-2" title="상품별 수수료율 × 매출. 회색 = 마스터 미설정, 기본값 사용">수수료</th>
                  {detail && <th className="text-right px-2" title="쿠팡 일반 4,100 · 대형 4,850 / 타 마켓 2,650 (건당)">물류</th>}
                  <th className="text-right px-2 whitespace-nowrap">광고비{adsLoading && <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />}</th>
                  {detail && <th className="text-right px-2" title="광고 전 공헌이익률">광고 전</th>}
                  <th className="text-right px-2" title="실제 ROAS. 빨강 = 손익분기 ROAS 미달">ROAS</th>
                  {detail && <th className="text-right px-2" title="손익분기 ROAS">손익분기</th>}
                  <th className="text-right px-2">공헌이익</th>
                  <th className="text-right px-3">마진</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const expandable = view === 'all' && r.lines.length > 1;
                  const isOpen = open.has(r.key);
                  return [
                    <tr key={r.key} className={cn('border-b border-line-2 h-11', !r.productId && 'bg-warn/5', expandable && 'cursor-pointer hover:bg-card-2')} onClick={() => expandable && setOpen(prev => { const n = new Set(prev); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })}>
                      <td className="px-4 text-fg">
                        <div className="flex items-center gap-1.5">
                          {expandable ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 text-fg-4" /> : <ChevronRight className="h-3.5 w-3.5 text-fg-4" />) : <span className="w-3.5" />}
                          <span className="truncate max-w-[260px] font-medium" title={r.productName}>{r.productName}</span>
                          {!r.productId && <span className="text-[10px] text-warn font-semibold shrink-0">미매칭</span>}
                        </div>
                      </td>
                      {view === 'all' && <td className="px-2 text-fg-3 whitespace-nowrap">{r.markets.map(m => MARKETS.find(x => x.id === m)?.short).join(' · ')}</td>}
                      <Cells r={r} detail={detail} />
                    </tr>,
                    ...(expandable && isOpen ? r.lines.map(l => {
                      const la = finish({ ...l, key: `${r.key}|${l.market}`, markets: [l.market], lines: [], contribution: 0, margin: null, roas: null, beRoas: null, preAdRate: null });
                      return (
                        <tr key={la.key} className="border-b border-line-2 h-10 bg-card-2/60 text-[11px]">
                          <td className="px-4 pl-10 text-fg-3">└ {MARKETS.find(x => x.id === l.market)?.label}</td>
                          <td className="px-2 text-fg-4">{MARKET_POLICY[l.market].feeSource}</td>
                          <Cells r={la} detail={detail} />
                        </tr>
                      );
                    }) : []),
                  ];
                })}
                <tr className="bg-card-2 font-semibold h-11 border-t border-line">
                  <td className="px-4 text-fg">합계</td>
                  {view === 'all' && <td />}
                  <Cells r={totals} detail={detail} />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="px-4 md:px-5 py-3 border-t border-line-2 text-[11px] text-fg-4 space-y-1">
            {view !== 'all' && <p>수수료 정책: {MARKET_POLICY[view].feeSource} → 마스터 시트의 상품별 수수료율이 있으면 그 값을 씁니다. 물류: {MARKET_POLICY[view].shipNote}.</p>}
            {sheet && (
              <p>
                시트 실적 대조 — 수수료 {won(sheet.marketFee)} / 물류 {won(sheet.logistics)} / 광고 {won(sheet.ad + sheet.marketing)} · 정책 추정 합 — 수수료 {won(totals.fee)} / 물류 {won(totals.logistics)} / 광고 {won(totals.ad)}
                {sheet.marketFee > 0 && Math.abs(totals.fee - sheet.marketFee) / sheet.marketFee > 0.15 && <span className="text-warn font-semibold"> · 수수료 추정이 실적과 15% 이상 다릅니다. 상품 수수료율을 확인하세요.</span>}
              </p>
            )}
            {rows.some(r => r.feeDefault) && <p>회색 수수료 = 마스터에 상품별 수수료율이 없어 기본값을 쓴 상품입니다. <Link href="/master" className="text-brand hover:underline">마스터 시트</Link>에서 채우면 정확해집니다.</p>}
          </div>
        )}
      </section>

      {/* 광고 매칭 상태 */}
      <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 md:p-5">
        <h3 className="text-[15px] font-bold text-fg mb-1">쿠팡 광고비 매칭 <span className="text-[11px] font-medium text-fg-4">광고분석 raw 기준</span></h3>
        {adsLoading ? (
          <p className="text-[12px] text-fg-4 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 광고 raw 집계 중… (수십만 행이라 몇 초 걸립니다)</p>
        ) : ads?.needsMigration ? (
          <p className="text-[12px] text-warn">DB 마이그레이션(00057) 적용 전이라 광고 raw 집계를 쓸 수 없습니다. 적용 후 새로고침하세요.</p>
        ) : ads?.error && !ads.products?.length ? (
          <p className="text-[12px] text-danger">광고 raw 집계 오류: {ads.error}. 마이그레이션 00058(인덱스·타임아웃) 적용이 필요할 수 있습니다.</p>
        ) : !ads || ads.totalCost === 0 ? (
          <p className="text-[12px] text-fg-4">{ym.replace('-', '.')} 광고 집계가 없습니다. <Link href="/settlement?tab=input" className="text-brand font-semibold hover:underline">입력 탭</Link>의 광고비 raw 카드에서 "이 PC 광고 raw → 월 집계 저장"을 누르면 채워집니다. (raw 는 <Link href="/ad-analysis" className="text-brand hover:underline">광고 분석</Link>에 올린 것을 씁니다)</p>
        ) : (
          <div className="text-[12px] text-fg-2 space-y-2">
            <p>광고비 {won(ads.totalCost)}원 중 상품 매칭 {won(ads.matchedCost)}원 ({ads.totalCost ? ((ads.matchedCost / ads.totalCost) * 100).toFixed(0) : 0}%)</p>
            {unmatchedAds.length > 0 && (
              <div className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2.5">
                <p className="font-semibold text-fg mb-1.5">마스터에 없는 옵션ID {unmatchedAds.length}개 — 미매칭 광고비 {won(ads.unmatchedCost)}원</p>
                <ul className="space-y-0.5">
                  {unmatchedAds.slice(0, 8).map(a => (
                    <li key={a.vendorItemId} className="flex items-center gap-2 tabular-nums">
                      <code className="text-[11px] bg-card px-1.5 py-0.5 rounded border border-line">{a.vendorItemId}</code>
                      <span className="truncate text-fg-3" title={a.name}>{a.name || '(상품명 없음)'}</span>
                      <span className="ml-auto shrink-0 text-fg">{won(a.cost)}원</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-fg-4">신상품이면 <Link href="/master" className="text-brand hover:underline">마스터 시트</Link> 쿠팡 "상품ID" 칸에 옵션ID를 넣고 판매가·수수료율을 채우세요. 다음 달부터 자동 매칭됩니다.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function finish(a: Agg): Agg {
  const preAd = a.revenue - a.cogs - a.fee - a.logistics;
  a.contribution = preAd - a.ad;
  a.margin = a.revenue > 0 ? (a.contribution / a.revenue) * 100 : null;
  a.preAdRate = a.revenue > 0 ? (preAd / a.revenue) * 100 : null;
  a.roas = a.ad > 0 ? (a.revenue / a.ad) * 100 : null;
  a.beRoas = preAd > 0 && a.revenue > 0 ? (a.revenue / preAd) * 100 : null;
  a.feeRate = a.revenue > 0 ? a.fee / a.revenue : 0;
  return a;
}

function Cells({ r, detail }: { r: Agg; detail: boolean }) {
  const td = 'px-2 text-right tabular-nums';
  const avg = r.qty > 0 ? r.revenue / r.qty : 0;
  const master = r.masterPriceQty > 0 ? r.masterPriceSum / r.masterPriceQty : null;
  const diff = master && avg ? ((avg - master) / master) * 100 : null;
  const adBad = r.roas != null && r.beRoas != null && r.roas < r.beRoas;
  return (
    <>
      {detail && <td className={cn(td, 'text-fg-3')}>{r.qty || '-'}</td>}
      <td className={cn(td, 'text-fg')}>{won(r.revenue)}</td>
      {detail && <td className={cn(td, 'text-fg-3 whitespace-nowrap')}>{avg ? won(avg) : '-'}{diff != null && Math.abs(diff) >= 1 && <span className={cn('block text-[10px]', diff < 0 ? 'text-danger' : 'text-success')}>{diff > 0 ? '+' : ''}{diff.toFixed(0)}% vs 정가</span>}</td>}
      <td className={cn(td, 'text-warn')}>{won(r.cogs)}</td>
      <td className={cn(td, r.feeDefault ? 'text-fg-5' : 'text-fg-3')} title={`수수료율 ${(r.feeRate * 100).toFixed(1)}%${r.feeDefault ? ' (기본값)' : ''}`}>{won(r.fee)}<span className="block text-[10px] text-fg-5">{fmtPct(r.feeRate * 100)}</span></td>
      {detail && <td className={cn(td, 'text-fg-3')}>{won(r.logistics)}</td>}
      <td className={cn(td, 'text-info')}>{r.ad ? won(r.ad) : <span className="text-fg-5">-</span>}</td>
      {detail && <td className={cn(td, r.preAdRate != null && r.preAdRate < 0 ? 'text-danger' : 'text-fg-2')}>{fmtPct(r.preAdRate)}</td>}
      <td className={cn(td, 'font-semibold', adBad ? 'text-danger' : r.roas != null ? 'text-success' : 'text-fg-5')} title={r.beRoas != null ? `손익분기 ${r.beRoas.toFixed(0)}%` : ''}>{r.roas == null ? '-' : `${r.roas.toFixed(0)}%`}{!detail && r.beRoas != null && <span className="block text-[10px] font-normal text-fg-5">기준 {r.beRoas.toFixed(0)}%</span>}</td>
      {detail && <td className={cn(td, 'text-fg-3')}>{r.beRoas == null ? '-' : `${r.beRoas.toFixed(0)}%`}</td>}
      <td className={cn(td, 'font-semibold', r.contribution < 0 ? 'text-danger' : 'text-fg')}>{won(r.contribution)}</td>
      <td className={cn('px-3 text-right tabular-nums font-semibold', r.margin == null ? 'text-fg-5' : r.margin < 0 ? 'text-danger' : r.margin < 10 ? 'text-warn' : 'text-success')}>{fmtPct(r.margin)}</td>
    </>
  );
}
