import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const maxDuration = 60;

/**
 * GET /api/settlement/product-ads?year_month=YYYY-MM
 *   광고분석 raw(ad_raw_rows) 를 월·광고집행 옵션ID 로 집계하고 SKU/상품에 매칭.
 *   → 정산 페이지에서 별도 광고 업로드 없이 상품별 광고비 산출.
 * GET /api/settlement/product-ads?months=1
 *   월별 raw 보유 현황.
 *
 * 마이그레이션 00057 의 RPC 가 없으면 { needsMigration: true } 반환 (UI 가 안내).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const sp = request.nextUrl.searchParams;

  if (sp.get('months') === '1') {
    const { data, error } = await admin.rpc('settlement_ad_months', { p_user: user.id });
    if (error) return NextResponse.json({ needsMigration: isMissing(error), error: error.message, months: [] });
    return NextResponse.json({ months: data ?? [] });
  }

  const ym = sp.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month=YYYY-MM 필요' }, { status: 400 });
  const prefix = ym.replace('-', '');

  const { data: rowsRaw, error } = await admin.rpc('settlement_ad_by_option', { p_user: user.id, p_prefix: prefix });
  const rows = (rowsRaw ?? []) as any[];
  if (error) return NextResponse.json({ needsMigration: isMissing(error), error: error.message, products: [] });

  // 옵션ID → sku 매핑: platform_skus(쿠팡 채널) 우선, rg_inventory_snapshots 보조
  const [{ data: ps }, { data: rg }] = await Promise.all([
    admin.from('platform_skus').select('platform_sku_id, sku_id, price, commission_rate, channel:channels(type), sku:skus(id, sku_code, product:products(id, name, logistics_tier))'),
    admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id'),
  ]);
  const skuByVendor = new Map<string, any>();
  for (const p of ps ?? []) {
    if (!p.platform_sku_id) continue;
    const t = (p as any).channel?.type;
    if (t && t !== 'coupang') continue;
    skuByVendor.set(String(p.platform_sku_id), p);
  }
  const rgMap = new Map<string, string>((rg ?? []).map((r: any) => [String(r.vendor_item_id), String(r.sku_id)]));
  // rg 만 있는 경우 sku 정보 보강
  const rgOnlyIds = [...new Set((rows ?? []).map((r: any) => String(r.vendor_item_id)).filter((v: string) => v && !skuByVendor.has(v) && rgMap.has(v)))];
  let skuInfo = new Map<string, any>();
  if (rgOnlyIds.length) {
    const skuIds = [...new Set(rgOnlyIds.map(v => rgMap.get(v)).filter(Boolean))].map(String);
    const { data: skus } = await admin.from('skus').select('id, sku_code, product:products(id, name, logistics_tier)').in('id', skuIds);
    skuInfo = new Map((skus ?? []).map((s: any) => [s.id, s]));
  }

  let total = 0, matchedCost = 0;
  const products = (rows ?? []).map((r: any) => {
    const vid = String(r.vendor_item_id ?? '');
    const cost = Number(r.cost) || 0;
    total += cost;
    const p = skuByVendor.get(vid);
    const sku = p?.sku ?? (rgMap.has(vid) ? skuInfo.get(rgMap.get(vid) ?? '') : null);
    const matched = !!sku?.product?.id;
    if (matched) matchedCost += cost;
    return {
      vendorItemId: vid,
      name: r.product_name ?? '',
      cost,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      convQty14d: Number(r.conv_qty_14d) || 0,
      convRev14d: Number(r.conv_rev_14d) || 0,
      rows: Number(r.rows_count) || 0,
      skuId: sku?.id ?? null,
      skuCode: sku?.sku_code ?? null,
      productId: sku?.product?.id ?? null,
      productName: sku?.product?.name ?? null,
      logisticsTier: sku?.product?.logistics_tier ?? null,
      matched,
    };
  }).sort((a: any, b: any) => b.cost - a.cost);

  return NextResponse.json({
    yearMonth: ym,
    platform: 'coupang',
    totalCost: total,
    matchedCost,
    unmatchedCost: total - matchedCost,
    items: products.length,
    matchedItems: products.filter((p: any) => p.matched).length,
    products,
  });
}

function isMissing(error: { message?: string; code?: string }) {
  const m = `${error.code ?? ''} ${error.message ?? ''}`;
  return /PGRST202|42883|Could not find the function|does not exist/i.test(m);
}
