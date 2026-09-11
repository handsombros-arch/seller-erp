/**
 * 토스 광고 raw(toss_ad_rows JSONB) → 월 집계(monthly_product_ads, platform 'toss').
 * 정산·드릴다운이 열릴 때마다 raw 전체를 훑지 않도록, 업로드 직후와 "재집계" 버튼에서 한 번만 집계해 둔다.
 * 기여 매출(총 전환 거래액)은 토스 보고서 기준 윈도우이며 통합 지표에는 쓰지 않는다 (마켓 안 참고용).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadExtraIds } from './extraIds';

export const toYm = (v: unknown): string => {
  if (typeof v === 'number' && v > 25569) { const d = new Date((v - 25569) * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
  const s = String(v ?? '').replace(/\D/g, ''); return s.length >= 6 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : '';
};
export const num = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const clean = (v: unknown) => String(v ?? '').replace(/\.0$/, '').trim();

export interface TossMatch { skuId: string | null; skuCode: string | null; productId: string | null; productName: string | null; logisticsTier: string | null }

/** 마스터(토스 채널 옵션ID·상품ID·상품명) → SKU/상품 매칭기 */
export async function buildTossMatcher(admin: SupabaseClient) {
  const [{ data: ps }, { data: prods }] = await Promise.all([
    admin.from('platform_skus').select('platform_sku_id, platform_product_id, platform_product_name, sku_id, channel:channels(type), sku:skus(id, sku_code, product:products(id, name, logistics_tier))'),
    admin.from('products').select('id, name, logistics_tier'),
  ]);
  const byOpt = new Map<string, any>(), byProd = new Map<string, any>();
  const listing: { name: string; p: any }[] = [];
  for (const p of (ps ?? []) as any[]) {
    if ((p.channel?.type ?? '') !== 'toss') continue;
    if (p.platform_sku_id) byOpt.set(String(p.platform_sku_id), p);
    if (p.platform_product_id) byProd.set(String(p.platform_product_id), p);
    if (p.platform_product_name) listing.push({ name: String(p.platform_product_name).trim(), p });
  }
  // 추가 옵션ID: 같은 SKU 의 기본 행 정보를 물려받는다
  const bySku = new Map<string, any>();
  for (const p of (ps ?? []) as any[]) if (p.sku?.id && !bySku.has(p.sku.id)) bySku.set(p.sku.id, p);
  for (const e of await loadExtraIds(admin)) { if (e.channelType !== 'toss' || byOpt.has(e.vid)) continue; const p = bySku.get(e.skuId); if (p) byOpt.set(e.vid, p); }
  const byName = new Map((prods ?? []).map((p: any) => [String(p.name).trim(), p]));
  const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
  const matchListing = (adName: string) => { const n = norm(adName); if (!n) return null; let best: any = null, bestLen = 0; for (const l of listing) { const ln = norm(l.name); if (!ln) continue; if ((n.startsWith(ln) || ln.startsWith(n)) && ln.length > bestLen) { best = l.p; bestLen = ln.length; } } return best; };
  const matchProduct = (adName: string) => { const n = norm(adName); for (const [name, p] of byName) { if (name && n.includes(norm(name))) return p; } return null; };
  return (opt: string, pid: string, adName: string): TossMatch => {
    const p = byOpt.get(opt) ?? byProd.get(pid) ?? matchListing(adName);
    const prod = p?.sku?.product ?? byName.get(adName.trim()) ?? matchProduct(adName) ?? null;
    return { skuId: p?.sku?.id ?? null, skuCode: p?.sku?.sku_code ?? null, productId: prod?.id ?? null, productName: prod?.name ?? null, logisticsTier: prod?.logistics_tier ?? null };
  };
}

/** 사용자의 toss_ad_rows 전체를 순서대로(dedup_key) 페이지 읽기 — 순서 없는 range 는 페이지가 겹치거나 빠질 수 있다 */
export async function readTossRows(admin: SupabaseClient, userId: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 500; i++) {
    const { data, error } = await admin.from('toss_ad_rows').select('data').eq('user_id', userId).order('dedup_key').range(i * 1000, i * 1000 + 999);
    if (error || !data?.length) break;
    for (const r of data) rows.push(r.data as Record<string, unknown>);
    if (data.length < 1000) break;
  }
  return rows;
}

export interface TossAggRow { year_month: string; vendorItemId: string; campaignId: string; campaignName: string; name: string; cost: number; impressions: number; clicks: number; convQty: number; convRev: number; rows: number; match: TossMatch }

/** raw 행 → 월 × 옵션(없으면 상품·광고) × 캠페인 집계 */
export function groupTossRows(rows: Record<string, unknown>[], match: (opt: string, pid: string, adName: string) => TossMatch, onlyMonths?: Set<string>): TossAggRow[] {
  const agg = new Map<string, TossAggRow>();
  for (const r of rows) {
    const ym = toYm(r['일자']); if (!ym || (onlyMonths && !onlyMonths.has(ym))) continue;
    const opt = clean(r['옵션 ID']), pid = clean(r['상품 ID']), adId = clean(r['광고 ID']), cid = clean(r['캠페인 ID']);
    const vid = opt || pid || adId;
    const key = `${ym}|${vid}|${cid}`;
    let a = agg.get(key);
    if (!a) {
      const adName = String(r['상품'] ?? r['광고'] ?? '');
      a = { year_month: ym, vendorItemId: vid, campaignId: cid, campaignName: String(r['캠페인'] ?? ''), name: String(r['광고'] ?? r['상품'] ?? ''), cost: 0, impressions: 0, clicks: 0, convQty: 0, convRev: 0, rows: 0, match: match(opt, pid, adName) };
      agg.set(key, a);
    }
    a.cost += num(r['집행 광고비']); a.impressions += num(r['노출수']); a.clicks += num(r['클릭수']); a.convQty += num(r['총 전환 판매수량']); a.convRev += num(r['총 전환 거래액']); a.rows += 1;
  }
  return [...agg.values()];
}

/** 지정한 달(없으면 raw 에 있는 모든 달)의 토스 월 집계를 다시 만든다. 반환: 월별 요약 */
export async function aggregateToss(admin: SupabaseClient, userId: string, months?: string[]) {
  const rows = await readTossRows(admin, userId);
  const match = await buildTossMatcher(admin);
  const only = months?.length ? new Set(months) : undefined;
  const grouped = groupTossRows(rows, match, only);
  const yms = [...new Set(grouped.map(g => g.year_month))].sort();
  const targetMonths = only ? [...only] : yms;
  if (targetMonths.length) {
    const { error } = await admin.from('monthly_product_ads').delete().eq('user_id', userId).eq('platform', 'toss').in('year_month', targetMonths);
    if (error) throw new Error(error.message);
  }
  const payload = grouped.map(g => ({
    user_id: userId, year_month: g.year_month, platform: 'toss', ad_type: 'toss',
    vendor_item_id: g.vendorItemId || null, sku_id: g.match.skuId, campaign_id: g.campaignId || null, campaign_name: g.campaignName || null, name: g.name || null,
    cost: g.cost, impressions: g.impressions, clicks: g.clicks, conv_qty_14d: g.convQty, conv_rev_14d: g.convRev, updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from('monthly_product_ads').upsert(payload.slice(i, i + 500), { onConflict: 'user_id,year_month,platform,ad_type,vendor_item_id,campaign_id' });
    if (error) throw new Error(error.message);
  }
  const summary: Record<string, { rows: number; cost: number; matchedCost: number; items: number }> = {};
  for (const g of grouped) { const s = summary[g.year_month] ?? (summary[g.year_month] = { rows: 0, cost: 0, matchedCost: 0, items: 0 }); s.rows += g.rows; s.cost += g.cost; s.items += 1; if (g.match.productId) s.matchedCost += g.cost; }
  return { rawRows: rows.length, months: summary };
}
