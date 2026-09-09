/** 상품별 순이익 계산 — 이 달 표와 월별 추이가 같은 규칙을 쓴다 */
import { MARKET_POLICY, SALES_MARKETS, isOversize, type Market } from './settlement';

export interface SalesRowLite { platform: string; sku_id: string | null; display_name: string; qty: number; revenue: number; total_cost: number; empty_qty?: number | null; sku?: { id: string; product?: { id: string; name: string; logistics_tier: string | null } | null } | null }
export interface AdRowLite { cost: number; productId: string | null; productName: string | null; name: string }
export interface PlatformSkuLite { sku_id: string; price: number | null; commission_rate: number | null; channel?: { type: string } | null }

export interface ProductLine {
  market: Market; productId: string | null; productName: string; tier: string | null;
  qty: number; revenue: number; cogs: number; fee: number; feeDefault: boolean; logistics: number; ad: number; marketing: number;
  contribution: number; margin: number | null; roas: number | null; beRoas: number | null;
}

export function buildPsMap(pskus: PlatformSkuLite[]) {
  const m = new Map<string, PlatformSkuLite>();
  for (const p of pskus) if (p.channel?.type) m.set(`${p.channel.type}|${p.sku_id}`, p);
  return m;
}

/** 매출 파일 행 + 광고 집계(쿠팡 ×1.1, 토스 그대로) → 마켓 × 상품 라인 */
/** 시트 마케팅비(마켓별, common 은 전체)를 각 라인의 매출 비례로 배분해 marketing 에 더한다 */
export function allocateSheetMarketing(lines: ProductLine[], sheet: Partial<Record<Market, number>> | undefined) {
  if (!sheet) return;
  const groups = new Map<string, ProductLine[]>();
  for (const l of lines) { const g = groups.get(l.market) ?? []; g.push(l); groups.set(l.market, g); }
  const spread = (target: ProductLine[], amount: number) => { const tot = target.reduce((s, l) => s + Math.max(0, l.revenue), 0); if (!tot || !amount) return; for (const l of target) l.marketing += amount * (Math.max(0, l.revenue) / tot); };
  for (const [mk, amt] of Object.entries(sheet) as [Market, number][]) {
    if (mk === 'common') spread(lines, amt); else spread(groups.get(mk) ?? [], amt);
  }
  for (const l of lines) {
    const preAd = l.revenue - l.cogs - l.fee - l.logistics;
    l.contribution = preAd - l.ad - l.marketing;
    l.margin = l.revenue > 0 ? (l.contribution / l.revenue) * 100 : null;
    l.roas = l.ad + l.marketing > 0 ? (l.revenue / (l.ad + l.marketing)) * 100 : null;
  }
}

export function computeProductLines(sales: SalesRowLite[], coupangAds: AdRowLite[] | null | undefined, tossAds: AdRowLite[] | null | undefined, psMap: Map<string, PlatformSkuLite>): ProductLine[] {
  const byKey = new Map<string, ProductLine>();
  const get = (market: Market, productId: string | null, name: string, tier: string | null) => {
    const key = `${market}|${productId ?? '__' + name}`;
    let l = byKey.get(key);
    if (!l) { l = { market, productId, productName: name, tier, qty: 0, revenue: 0, cogs: 0, fee: 0, feeDefault: false, logistics: 0, ad: 0, marketing: 0, contribution: 0, margin: null, roas: null, beRoas: null }; byKey.set(key, l); }
    return l;
  };
  for (const s of sales) {
    const market = (SALES_MARKETS.includes(s.platform as Market) ? s.platform : 'common') as Market;
    const l = get(market, s.sku?.product?.id ?? null, s.sku?.product?.name ?? s.display_name, s.sku?.product?.logistics_tier ?? null);
    const qty = Number(s.qty) || 0, empty = Number(s.empty_qty) || 0, rev = Number(s.revenue) || 0;
    l.qty += qty; l.revenue += rev;
    l.cogs += empty > 0 && qty > 0 ? Number(s.total_cost) * ((qty - empty) / qty) : Number(s.total_cost) || 0;
    if (empty > 0 && qty > 0) l.marketing += (rev / qty) * empty;
    const policy = MARKET_POLICY[market];
    const ps = s.sku_id ? psMap.get(`${market}|${s.sku_id}`) : undefined;
    const hasRate = ps?.commission_rate != null && Number(ps.commission_rate) > 0;
    l.fee += rev * (hasRate ? Number(ps!.commission_rate) / 100 : policy.feeRate);
    if (!hasRate) l.feeDefault = true;
    const perUnit = market === 'coupang' ? (isOversize(l.productName, l.tier) ? (policy.oversizePerUnit ?? policy.shipPerUnit) : policy.shipPerUnit) : policy.shipPerUnit;
    l.logistics += qty * perUnit;
  }
  for (const a of coupangAds ?? []) if (a.productId) get('coupang', a.productId, a.productName ?? a.name, null).ad += a.cost * 1.1;
  for (const a of tossAds ?? []) if (a.productId) get('toss', a.productId, a.productName ?? a.name, null).ad += a.cost;
  for (const l of byKey.values()) {
    const preAd = l.revenue - l.cogs - l.fee - l.logistics;
    l.contribution = preAd - l.ad - l.marketing;
    l.margin = l.revenue > 0 ? (l.contribution / l.revenue) * 100 : null;
    l.roas = l.ad + l.marketing > 0 ? (l.revenue / (l.ad + l.marketing)) * 100 : null;
    l.beRoas = preAd > 0 && l.revenue > 0 ? (l.revenue / preAd) * 100 : null;
  }
  return [...byKey.values()];
}
