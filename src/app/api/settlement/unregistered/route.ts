import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/settlement/unregistered?year_month=YYYY-MM
 * 마스터(platform_skus)에 없는 쿠팡 옵션ID 를 세 출처에서 모아 "등록 필요" 큐로 돌려준다.
 *  - RG API 동기화(rg_inventory_snapshots): 새 옵션이 생기면 바로 잡힘
 *  - 광고 raw 월 집계(monthly_product_ads): sku 매칭 안 된 옵션 + 광고비
 *  - 매출 파일(monthly_product_sales): sku 매칭 안 된 행 (옵션ID 없는 토스/스스는 이름만)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const ym = request.nextUrl.searchParams.get('year_month') ?? '';
  const admin = await createAdminClient();

  const ignRes = await admin.from('settlement_ignored').select('key, label, created_at');
  const ignored = new Map<string, { label: string | null; created_at: string }>();
  if (!ignRes.error) for (const r of ignRes.data ?? []) ignored.set(r.key, { label: r.label, created_at: r.created_at });
  const [chRes, psRes, rgRes, adsRes, salesRes, skusRes] = await Promise.all([
    admin.from('channels').select('id, name, type'),
    admin.from('platform_skus').select('platform_sku_id, sku_id, channel:channels(type)'),
    // 최신 스냅샷·재고 있는 옵션만 (컬럼이 없는 DB 면 전체)
    admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id, item_name, snapshot_date, quantity').order('snapshot_date', { ascending: false }).limit(2000)
      .then(r => r.error ? admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id, item_name') : r),
    ym ? admin.from('monthly_product_ads').select('vendor_item_id, name, cost, sku_id').eq('user_id', user.id).eq('year_month', ym).eq('platform', 'coupang') : Promise.resolve({ data: [] as any[] }),
    ym ? admin.from('monthly_product_sales').select('platform, display_name, qty, revenue, sku_id, vendor_item_id').eq('user_id', user.id).eq('year_month', ym).is('sku_id', null)
      .then(r => r.error ? admin.from('monthly_product_sales').select('platform, display_name, qty, revenue, sku_id').eq('user_id', user.id).eq('year_month', ym).is('sku_id', null) : r) : Promise.resolve({ data: [] as any[] }),
    admin.from('skus').select('id, sku_code, option_values, cost_price, product:products(id, name)').order('sku_code'),
  ]);

  const coupangChannel = (chRes.data ?? []).find((c: any) => c.type === 'coupang');
  const known = new Set<string>();
  for (const p of psRes.data ?? []) if (p.platform_sku_id && ((p as any).channel?.type ?? 'coupang') === 'coupang') known.add(String(p.platform_sku_id));

  type Item = { vendorItemId: string; name: string; sources: string[]; adCost: number; suggestedSkuId: string | null };
  const items = new Map<string, Item>();
  const get = (vid: string) => { let it = items.get(vid); if (!it) { it = { vendorItemId: vid, name: '', sources: [], adCost: 0, suggestedSkuId: null }; items.set(vid, it); } return it; };

  const rgRows = ((rgRes as any).data ?? []) as any[];
  const latestDate = rgRows.find(r => r.snapshot_date)?.snapshot_date ?? null;
  for (const r of rgRows) {
    if (latestDate && r.snapshot_date !== latestDate) continue;
    if (r.quantity !== undefined && r.quantity !== null && Number(r.quantity) <= 0) continue;
    const vid = String(r.vendor_item_id ?? ''); if (!vid || known.has(vid)) continue;
    const it = get(vid); if (!it.sources.includes('RG API')) it.sources.push('RG API'); if (r.sku_id && !it.suggestedSkuId) it.suggestedSkuId = r.sku_id; if (!it.name && r.item_name) it.name = r.item_name;
  }
  for (const r of (adsRes.data ?? []) as any[]) {
    const vid = String(r.vendor_item_id ?? ''); if (!vid || known.has(vid)) continue;
    const it = get(vid); if (!it.sources.includes('광고 raw')) it.sources.push('광고 raw'); it.adCost += Number(r.cost) || 0; if (!it.name && r.name) it.name = r.name; if (r.sku_id && !it.suggestedSkuId) it.suggestedSkuId = r.sku_id;
  }
  const salesRows = ((salesRes as any).data ?? []) as any[];
  for (const r of salesRows) {
    if (r.platform !== 'coupang' || !r.vendor_item_id) continue;
    const vid = String(r.vendor_item_id); if (known.has(vid)) continue;
    const it = get(vid); if (!it.sources.includes('매출 파일')) it.sources.push('매출 파일'); if (!it.name && r.display_name) it.name = r.display_name;
  }
  const nameOnly = salesRows.filter((r: any) => !(r.platform === 'coupang' && r.vendor_item_id)).map((r: any) => ({ platform: r.platform, name: r.display_name, qty: Number(r.qty) || 0, revenue: Number(r.revenue) || 0 }))
    .filter((r: any) => !ignored.has(`name:${r.platform}:${r.name}`));
  const visibleItems = [...items.values()].filter(it => !ignored.has(`vid:${it.vendorItemId}`));

  const skus = (skusRes.data ?? []).map((s: any) => ({ id: s.id, code: s.sku_code, name: `${s.product?.name ?? ''}${s.option_values ? ' ' + (typeof s.option_values === 'string' ? s.option_values : JSON.stringify(s.option_values)) : ''}`.trim(), productId: s.product?.id ?? null, costPrice: s.cost_price == null ? null : Number(s.cost_price) }));

  return NextResponse.json({
    yearMonth: ym,
    coupangChannelId: coupangChannel?.id ?? null,
    items: visibleItems.sort((a, b) => b.adCost - a.adCost),
    nameOnly,
    skus,
    ignored: [...ignored.entries()].map(([key, v]) => ({ key, label: v.label, created_at: v.created_at })),
    ignoreSupported: !ignRes.error,
  });
}

/** POST { key, label?, ignore: true|false } — 숨기기 / 복원 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const key = String(body.key ?? '');
  if (!/^(vid|name):/.test(key)) return NextResponse.json({ error: 'key 필요' }, { status: 400 });
  const admin = await createAdminClient();
  if (body.ignore === false) {
    const { error } = await admin.from('settlement_ignored').delete().eq('key', key);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ignored: false });
  }
  const { error } = await admin.from('settlement_ignored').upsert({ key, label: body.label ?? null, reason: body.reason ?? null, created_by: user.id }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? '마이그레이션 00062 를 적용해야 숨기기가 저장됩니다' : error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ignored: true });
}
