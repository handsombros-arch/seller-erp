import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { readTossRows, buildTossMatcher, groupTossRows } from '@/lib/settlement/tossAgg';

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
    // 월 집계 테이블 기준 (raw RPC 는 수십만 행 스캔이라 쓰지 않는다)
    const { data, error } = await admin.from('monthly_product_ads').select('year_month, cost').eq('user_id', user.id).eq('platform', sp.get('platform') === 'toss' ? 'toss' : 'coupang');
    if (error) return NextResponse.json({ error: error.message, months: [] });
    const acc = new Map<string, { rows_count: number; cost: number }>();
    for (const r of data ?? []) { const a = acc.get(r.year_month) ?? { rows_count: 0, cost: 0 }; a.rows_count += 1; a.cost += Number(r.cost) || 0; acc.set(r.year_month, a); }
    const months = [...acc.entries()].map(([year_month, v]) => ({ year_month, ...v })).sort((a, b) => b.year_month.localeCompare(a.year_month));
    return NextResponse.json({ months });
  }

  const ym = sp.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month=YYYY-MM 필요' }, { status: 400 });
  const prefix = ym.replace('-', '');

  // 토스 광고 raw (toss_ad_rows JSONB) → 월 × 옵션 ID 집계. 매칭: platform_skus(토스 채널) 옵션 ID → 상품 ID → 상품명
  if (sp.get('platform') === 'toss') {
    // 1순위: 월 집계(monthly_product_ads platform 'toss') — 업로드 직후·재집계 버튼에서 저장됨
    const { data: agg } = await admin.from('monthly_product_ads')
      .select('vendor_item_id, campaign_id, campaign_name, name, cost, impressions, clicks, conv_qty_14d, conv_rev_14d, sku_id, sku:skus(id, sku_code, product:products(id, name, logistics_tier))')
      .eq('user_id', user.id).eq('year_month', ym).eq('platform', 'toss');
    let products: any[];
    let source = 'monthly_product_ads';
    if (agg && agg.length) {
      const merged = new Map<string, any>();
      for (const r of agg as any[]) {
        const vid = String(r.vendor_item_id ?? '');
        const key = vid || `name:${r.name ?? ''}`;
        const cur = merged.get(key) ?? { vendorItemId: vid, name: r.name ?? '', cost: 0, impressions: 0, clicks: 0, convQty14d: 0, convRev14d: 0, rows: 0, skuId: null, skuCode: null, productId: null, productName: null, logisticsTier: null, matched: false, campaigns: [] as { id: string; name: string; cost: number }[] };
        cur.cost += Number(r.cost) || 0; cur.impressions += Number(r.impressions) || 0; cur.clicks += Number(r.clicks) || 0; cur.convQty14d += Number(r.conv_qty_14d) || 0; cur.convRev14d += Number(r.conv_rev_14d) || 0; cur.rows += 1;
        cur.campaigns.push({ id: String(r.campaign_id ?? ''), name: String(r.campaign_name ?? ''), cost: Number(r.cost) || 0 });
        if (r.sku?.product?.id && !cur.productId) { cur.skuId = r.sku.id; cur.skuCode = r.sku.sku_code; cur.productId = r.sku.product.id; cur.productName = r.sku.product.name; cur.logisticsTier = r.sku.product.logistics_tier ?? null; cur.matched = true; }
        merged.set(key, cur);
      }
      products = [...merged.values()].sort((a, b) => b.cost - a.cost);
    } else {
      // 2순위: raw 직접 집계 (집계 전 달). 매칭은 현재 마스터 기준
      source = 'toss_ad_rows';
      const rows = await readTossRows(admin, user.id);
      const match = await buildTossMatcher(admin);
      products = groupTossRows(rows, match, new Set([ym])).map(g => ({ vendorItemId: g.vendorItemId, name: g.name, cost: g.cost, impressions: g.impressions, clicks: g.clicks, convQty14d: g.convQty, convRev14d: g.convRev, rows: g.rows, ...g.match, matched: !!g.match.productId }))
        .sort((a, b) => b.cost - a.cost);
    }
    let total = 0, matchedCost = 0; for (const p of products) { total += p.cost; if (p.matched) matchedCost += p.cost; }
    return NextResponse.json({ yearMonth: ym, platform: 'toss', source, window: '토스 보고서 기준', totalCost: total, matchedCost, unmatchedCost: total - matchedCost, items: products.length, matchedItems: products.filter(p => p.matched).length, products });
  }

  // 1순위: 월 집계 테이블 (정산 페이지 "이 PC 광고 raw → 월 집계 저장" 또는 예전 업로드)
  const { data: agg } = await admin.from('monthly_product_ads')
    .select('vendor_item_id, name, cost, impressions, clicks, conv_qty_14d, conv_rev_14d, sku_id, sku:skus(id, sku_code, product:products(id, name, logistics_tier))')
    .eq('user_id', user.id).eq('year_month', ym).eq('platform', 'coupang');
  if (agg && agg.length) {
    let total = 0, matchedCost = 0;
    const merged = new Map<string, any>();
    for (const r of agg as any[]) {
      const vid = String(r.vendor_item_id ?? '');
      const cur = merged.get(vid) ?? { vendorItemId: vid, name: r.name ?? '', cost: 0, impressions: 0, clicks: 0, convQty14d: 0, convRev14d: 0, rows: 0, skuId: null, skuCode: null, productId: null, productName: null, logisticsTier: null, matched: false };
      cur.cost += Number(r.cost) || 0; cur.impressions += Number(r.impressions) || 0; cur.clicks += Number(r.clicks) || 0;
      cur.convQty14d += Number(r.conv_qty_14d) || 0; cur.convRev14d += Number(r.conv_rev_14d) || 0; cur.rows += 1;
      if (r.sku?.product?.id && !cur.productId) { cur.skuId = r.sku.id; cur.skuCode = r.sku.sku_code; cur.productId = r.sku.product.id; cur.productName = r.sku.product.name; cur.logisticsTier = r.sku.product.logistics_tier ?? null; cur.matched = true; }
      merged.set(vid, cur);
    }
    const products = [...merged.values()].sort((a, b) => b.cost - a.cost);
    for (const p of products) { total += p.cost; if (p.matched) matchedCost += p.cost; }
    return NextResponse.json({ yearMonth: ym, platform: 'coupang', source: 'monthly_product_ads', totalCost: total, matchedCost, unmatchedCost: total - matchedCost, items: products.length, matchedItems: products.filter(p => p.matched).length, products });
  }

  // 2순위: raw RPC — 기본은 건너뛴다. DB ad_raw_rows 는 동기화가 멈춘 데다(9/10) 키워드·일별 보고서 중복이 남아 있어
  // 결과가 부풀고 수십 초 걸린다. 월 집계가 없는 달은 빈 결과 + 안내로 바로 돌려주고, ?raw=1 일 때만 옛 경로를 쓴다.
  if (sp.get('raw') !== '1') {
    return NextResponse.json({ yearMonth: ym, platform: 'coupang', source: 'none', totalCost: 0, matchedCost: 0, unmatchedCost: 0, items: 0, matchedItems: 0, products: [], hint: `${ym} 쿠팡 광고 월 집계가 없습니다. 입력 탭 광고비 raw 카드에서 '이 PC 광고 raw → 월 집계 저장'을 실행하세요.` });
  }
  const { data: rowsRaw, error } = await admin.rpc('settlement_ad_by_option', { p_user: user.id, p_prefix: prefix });
  const rows = (rowsRaw ?? []) as any[];
  if (error) return NextResponse.json({ needsMigration: isMissing(error), error: error.message, products: [], totalCost: 0 });

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
