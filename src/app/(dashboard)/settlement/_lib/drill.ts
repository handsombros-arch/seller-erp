/**
 * "왜?" 드릴다운 계산 — 손익 라인 → 시트 항목 → 마켓 → 상품 → 옵션.
 * 원칙(사용자 합의):
 *  - 통합·의사결정 지표는 실매출(매출 파일 확정) 기준. 플랫폼 기여 매출(룩백 윈도우)은 쓰지 않는다.
 *  - 마켓 안에서만 그 플랫폼의 ROAS(윈도우 표기)를 참고로 보여준다. 마켓이 다른 ROAS 는 합치지 않는다.
 *  - 상품 단계 이익은 공헌이익(고정비 차감 전). 역마진 판단 기준.
 */
import type { Market, MarketPL, PL, PlLine, LeafRow } from './settlement';
import { MARKET_POLICY, SALES_MARKETS, isOversize } from './settlement';
import type { ProductLine, SalesRowLite } from './productProfit';

export type SeriesPoint = { ym: string; total: PL; markets: MarketPL[]; leaves: LeafRow[] };

/** 손익 라인(PlLine) ↔ PL 키 */
export const LINE_KEY: Partial<Record<PlLine, keyof PL>> = { revenue: 'revenue', coupon: 'coupon', cogs: 'cogs', market_fee: 'marketFee', logistics: 'logistics', ad: 'ad', marketing: 'marketing', fixed: 'fixed', other: 'other' };
export const KEY_LINE: Partial<Record<keyof PL, PlLine>> = Object.fromEntries(Object.entries(LINE_KEY).map(([l, k]) => [k, l])) as Partial<Record<keyof PL, PlLine>>;
/** 비용 라인 = 늘면 나쁨 */
export const COST_KEYS: (keyof PL)[] = ['coupon', 'cogs', 'marketFee', 'logistics', 'ad', 'marketing', 'fixed', 'other', 'taxEstimate'];

export interface Delta { cur: number; prev: number | null; avg3: number | null; dPrev: number | null; dAvg: number | null; pctPrev: number | null }

/** 기준 월(base)과 그 전 달·3개월 평균 대비 변화 */
export function deltaOf(values: (number | null)[], baseIdx: number): Delta {
  const cur = values[baseIdx] ?? 0;
  const prev = baseIdx > 0 ? values[baseIdx - 1] : null;
  const win = values.slice(Math.max(0, baseIdx - 3), baseIdx).filter((v): v is number => v != null);
  const avg3 = win.length ? win.reduce((s, v) => s + v, 0) / win.length : null;
  return { cur, prev, avg3, dPrev: prev == null ? null : cur - prev, dAvg: avg3 == null ? null : cur - avg3, pctPrev: prev ? ((cur - prev) / Math.abs(prev)) * 100 : null };
}

/** 라인별 월 시계열 + Δ */
export function lineRows(series: SeriesPoint[], baseIdx: number, keys: (keyof PL)[]) {
  return keys.map(key => { const values = series.map(s => s.total[key]); return { key, values, delta: deltaOf(values, baseIdx) }; });
}

export interface ItemRow { id: string; label: string; parentLabel: string | null; market: Market | null; values: (number | null)[]; delta: Delta; isNew: boolean; isGone: boolean; share: number | null }

/** 한 라인의 말단 항목별 월 시계열. 항목 값은 시트 부호 적용값(LeafRow.value) */
export function itemRows(series: SeriesPoint[], baseIdx: number, line: PlLine): ItemRow[] {
  const byId = new Map<string, ItemRow>();
  series.forEach((s, i) => {
    for (const l of s.leaves) {
      if (l.tags.pl_line !== line) continue;
      let r = byId.get(l.item.id);
      if (!r) { r = { id: l.item.id, label: l.item.label, parentLabel: l.parent?.label ?? null, market: (l.tags.market as Market) ?? null, values: series.map(() => null), delta: deltaOf([], 0), isNew: false, isGone: false, share: null }; byId.set(l.item.id, r); }
      r.values[i] = (r.values[i] ?? 0) + l.value;
    }
  });
  const rows = [...byId.values()];
  const lineDelta = rows.reduce((s, r) => s + (deltaOf(r.values, baseIdx).dPrev ?? 0), 0);
  for (const r of rows) {
    r.delta = deltaOf(r.values, baseIdx);
    const before = r.values.slice(0, baseIdx).some(v => v);
    r.isNew = !!r.values[baseIdx] && !before;
    r.isGone = !r.values[baseIdx] && !!r.values[baseIdx - 1];
    r.share = lineDelta ? ((r.delta.dPrev ?? 0) / lineDelta) * 100 : null;
  }
  return rows.sort((a, b) => Math.abs(b.delta.dPrev ?? 0) - Math.abs(a.delta.dPrev ?? 0) || (b.values[baseIdx] ?? 0) - (a.values[baseIdx] ?? 0));
}

/** 마켓 건강도 시계열: 실매출·원가·수수료·물류·광고·마케팅·공헌이익 + 비율 */
export interface MarketRow { key: string; label: string; values: (number | null)[]; pct?: boolean; delta: Delta }
export function marketRows(series: SeriesPoint[], baseIdx: number, market: Market): MarketRow[] {
  const pick = (f: (m: MarketPL) => number | null) => series.map(s => { const m = s.markets.find(x => x.market === market); return m ? f(m) : null; });
  const mk = (key: string, label: string, f: (m: MarketPL) => number | null, pct = false): MarketRow => { const values = pick(f); return { key, label, values, pct, delta: deltaOf(values, baseIdx) }; };
  const ratio = (num: (m: MarketPL) => number) => (m: MarketPL) => m.netRevenue ? (num(m) / m.netRevenue) * 100 : null;
  return [
    mk('netRevenue', '실매출', m => m.netRevenue),
    mk('cogs', '매입원가', m => m.cogs),
    mk('marketFee', '마켓 수수료', m => m.marketFee),
    mk('logistics', '물류·배송', m => m.logistics),
    mk('ad', '광고비', m => m.ad),
    mk('marketing', '마케팅', m => m.marketing),
    mk('contribution', '공헌이익', m => m.contribution),
    mk('cogsRate', '원가율', ratio(m => m.cogs), true),
    mk('logisticsRate', '물류비율', ratio(m => m.logistics), true),
    mk('adRate', '광고비율 (광고+마케팅 ÷ 실매출)', ratio(m => m.ad + m.marketing), true),
    mk('margin', '공헌이익률', ratio(m => m.contribution), true),
  ];
}

/** 광고 raw 집계 행 (product-ads API). 쿠팡=14일 전환, 토스=토스 보고서 기준 */
export interface AdProduct { vendorItemId: string; name: string; cost: number; impressions: number; clicks: number; convQty14d: number; convRev14d: number; skuId: string | null; productId: string | null; productName: string | null; matched: boolean }
export const AD_WINDOW: Record<string, string> = { coupang: '14일', toss: '토스 기준' };

export interface ProductRow {
  key: string; productId: string | null; name: string; market: Market | 'all';
  qty: number[]; revenue: number[]; cogs: number[]; fee: number[]; logistics: number[]; ad: number[]; marketing: number[]; contribution: number[];
  /** 기준 월 지표 */
  adRate: number | null; preAdMargin: number | null; margin: number | null; beAdRate: number | null;
  flags: ('역마진' | '광고과다' | '신규' | '중단')[];
  d: { revenue: Delta; qty: Delta; ad: Delta; contribution: Delta; logistics: Delta; cogs: Delta };
  /** 마켓 내 참고: 플랫폼 기여 ROAS (통합 보기에서는 null) */
  platformRoas: number | null;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const Z: Delta = { cur: 0, prev: null, avg3: null, dPrev: null, dAvg: null, pctPrev: null };
const EMPTY_D = { revenue: Z, qty: Z, ad: Z, contribution: Z, logistics: Z, cogs: Z };
const EMPTY_D4 = { revenue: Z, qty: Z, ad: Z, contribution: Z };
type SkuLite = { sku_code?: string | null; option_values?: Record<string, string> | null } | null | undefined;

/** 마켓(또는 통합) 상품별 월 시계열 + 기준 월 Δ·플래그 */
export function productRows(linesByMonth: Map<string, ProductLine[]>, adsByMonth: Map<string, { coupang: AdProduct[]; toss: AdProduct[] }>, months: string[], baseIdx: number, market: Market | 'all'): ProductRow[] {
  const byKey = new Map<string, ProductRow>();
  const blank = () => months.map(() => 0);
  months.forEach((m, i) => {
    for (const l of linesByMonth.get(m) ?? []) {
      if (market !== 'all' && l.market !== market) continue;
      const key = l.productId ?? `__${l.productName}`;
      let r = byKey.get(key);
      if (!r) { r = { key, productId: l.productId, name: l.productName, market, qty: blank(), revenue: blank(), cogs: blank(), fee: blank(), logistics: blank(), ad: blank(), marketing: blank(), contribution: blank(), adRate: null, preAdMargin: null, margin: null, beAdRate: null, flags: [], d: EMPTY_D, platformRoas: null }; byKey.set(key, r); }
      r.qty[i] += l.qty; r.revenue[i] += l.revenue; r.cogs[i] += l.cogs; r.fee[i] += l.fee; r.logistics[i] += l.logistics; r.ad[i] += l.ad; r.marketing[i] += l.marketing; r.contribution[i] += l.contribution;
    }
  });
  const base = months[baseIdx];
  const adsBase = adsByMonth.get(base);
  for (const r of byKey.values()) {
    const rev = r.revenue[baseIdx], adm = r.ad[baseIdx] + r.marketing[baseIdx];
    const preAd = rev - r.cogs[baseIdx] - r.fee[baseIdx] - r.logistics[baseIdx];
    r.adRate = rev ? (adm / rev) * 100 : null;
    r.preAdMargin = rev ? (preAd / rev) * 100 : null;
    r.margin = rev ? (r.contribution[baseIdx] / rev) * 100 : null;
    r.beAdRate = r.preAdMargin;   // 광고비율이 광고 전 공헌이익률을 넘으면 적자
    if (rev > 0 && r.contribution[baseIdx] < 0) r.flags.push('역마진');
    if (r.adRate != null && r.beAdRate != null && r.adRate > r.beAdRate && !r.flags.includes('역마진')) r.flags.push('광고과다');
    const before = r.revenue.slice(0, baseIdx).some(v => v);
    if (rev && !before) r.flags.push('신규');
    if (!rev && baseIdx > 0 && r.revenue[baseIdx - 1]) r.flags.push('중단');
    r.d = { revenue: deltaOf(r.revenue, baseIdx), qty: deltaOf(r.qty, baseIdx), ad: deltaOf(r.ad.map((v, i) => v + r.marketing[i]), baseIdx), contribution: deltaOf(r.contribution, baseIdx), logistics: deltaOf(r.logistics, baseIdx), cogs: deltaOf(r.cogs, baseIdx) };
    if (market === 'coupang' || market === 'toss') {
      const list = adsBase?.[market] ?? [];
      const mine = list.filter(a => r.productId ? a.productId === r.productId : a.productName === r.name);
      const c = sum(mine.map(a => a.cost)), cr = sum(mine.map(a => a.convRev14d));
      r.platformRoas = c > 0 ? (cr / c) * 100 : null;
    }
  }
  return [...byKey.values()];
}

export interface OptionRow { skuId: string | null; label: string; skuCode: string | null; qty: number[]; revenue: number[]; cogs: number[]; fee: number[]; logistics: number[]; ad: number[]; contribution: number[]; d: { revenue: Delta; qty: Delta; ad: Delta; contribution: Delta }; flags: ('역마진' | '신규' | '중단')[]; platformRoas: number | null }

/** 상품 → 옵션(SKU). 매출 파일 행(sku 단위) + 광고(옵션ID→sku). 수수료·물류는 마켓 정책으로 추정 */
export function optionRows(salesByMonth: Map<string, SalesRowLite[]>, adsByMonth: Map<string, { coupang: AdProduct[]; toss: AdProduct[] }>, months: string[], baseIdx: number, market: Market | 'all', productId: string | null, productName: string): OptionRow[] {
  const byKey = new Map<string, OptionRow>();
  const blank = () => months.map(() => 0);
  const get = (skuId: string | null, label: string, skuCode: string | null) => {
    const key = skuId ?? `__${label}`;
    let r = byKey.get(key);
    if (!r) { r = { skuId, label, skuCode, qty: blank(), revenue: blank(), cogs: blank(), fee: blank(), logistics: blank(), ad: blank(), contribution: blank(), d: EMPTY_D4, flags: [], platformRoas: null }; byKey.set(key, r); }
    if (!r.label && label) r.label = label; if (!r.skuCode && skuCode) r.skuCode = skuCode;
    return r;
  };
  months.forEach((m, i) => {
    for (const s of salesByMonth.get(m) ?? []) {
      const mk = (SALES_MARKETS.includes(s.platform as Market) ? s.platform : 'common') as Market;
      if (market !== 'all' && mk !== market) continue;
      const pid = s.sku?.product?.id ?? null, pname = s.sku?.product?.name ?? s.display_name;
      if (productId ? pid !== productId : pname !== productName) continue;
      const skuX = s.sku as SkuLite; const opts = skuX?.option_values ? Object.values(skuX.option_values).filter(Boolean).join(' / ') : '';
      const r = get(s.sku_id, s.sku_id ? (opts || '기본') : s.display_name, skuX?.sku_code ?? null);
      const qty = Number(s.qty) || 0, empty = Number(s.empty_qty) || 0, rev = Number(s.revenue) || 0;
      r.qty[i] += qty; r.revenue[i] += rev;
      r.cogs[i] += empty > 0 && qty > 0 ? Number(s.total_cost) * ((qty - empty) / qty) : Number(s.total_cost) || 0;
      const policy = MARKET_POLICY[mk];
      const perUnit = mk === 'coupang' ? (isOversize(pname, s.sku?.product?.logistics_tier ?? null) ? (policy.oversizePerUnit ?? policy.shipPerUnit) : policy.shipPerUnit) : policy.shipPerUnit;
      r.fee[i] += rev * policy.feeRate; r.logistics[i] += qty * perUnit;
    }
    // 광고: 옵션ID → skuId
    const ads = adsByMonth.get(m);
    for (const mk of (market === 'all' ? ['coupang', 'toss'] : [market]) as ('coupang' | 'toss')[]) {
      for (const a of ads?.[mk] ?? []) {
        if (!(productId ? a.productId === productId : a.productName === productName)) continue;
        const cost = (mk === 'coupang' ? a.cost * 1.1 : a.cost);
        if (a.skuId) get(a.skuId, '', null).ad[i] += cost;
        else get(null, a.name || '(옵션 미매칭)', null).ad[i] += cost;
      }
    }
  });
  // 공헌이익 = 매출 − 원가 − 수수료(정책) − 물류(정책) − 광고
  for (const r of byKey.values()) {
    for (let i = 0; i < months.length; i++) r.contribution[i] = r.revenue[i] - r.cogs[i] - r.fee[i] - r.logistics[i] - r.ad[i];
    r.d = { revenue: deltaOf(r.revenue, baseIdx), qty: deltaOf(r.qty, baseIdx), ad: deltaOf(r.ad, baseIdx), contribution: deltaOf(r.contribution, baseIdx) };
    if (r.revenue[baseIdx] > 0 && r.contribution[baseIdx] < 0) r.flags.push('역마진');
    if (r.revenue[baseIdx] && !r.revenue.slice(0, baseIdx).some(v => v)) r.flags.push('신규');
    if (!r.revenue[baseIdx] && baseIdx > 0 && r.revenue[baseIdx - 1]) r.flags.push('중단');
    if ((market === 'coupang' || market === 'toss') && r.skuId) {
      const mine = (adsByMonth.get(months[baseIdx])?.[market] ?? []).filter(a => a.skuId === r.skuId);
      const c = sum(mine.map(a => a.cost)), cr = sum(mine.map(a => a.convRev14d));
      r.platformRoas = c > 0 ? (cr / c) * 100 : null;
    }
  }
  return [...byKey.values()].sort((a, b) => Math.abs(b.d.contribution.dPrev ?? 0) - Math.abs(a.d.contribution.dPrev ?? 0) || b.revenue[baseIdx] - a.revenue[baseIdx]);
}
