import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';


export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(Number(searchParams.get('days') ?? '30'), 90);

  const admin = await createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const { data: snapshots, error } = await admin
    .from('rg_inventory_snapshots')
    .select('snapshot_date, vendor_item_id, external_sku_id, item_name, total_orderable_qty, sales_last_30d, sku_id, sku:skus(sku_code, product:products(name))')
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // 반품재판매로 분류된 vendor_item_id 목록
  const { data: returnRows } = await admin
    .from('rg_return_vendor_items')
    .select('vendor_item_id, grade');
  const returnMap = new Map<string, string | null>(
    (returnRows ?? []).map((r) => [r.vendor_item_id, r.grade])
  );

  // external_sku_id → platform_product_name 맵 (sku 미매칭 항목 상품명 표시용)
  const extIds = [...new Set((snapshots ?? []).map((r) => r.external_sku_id).filter(Boolean))];
  const { data: psNames } = await admin
    .from('platform_skus')
    .select('platform_sku_id, platform_product_name')
    .in('platform_sku_id', extIds);
  const platformNameMap = new Map<string, string>(
    (psNames ?? []).map((r) => [r.platform_sku_id, r.platform_product_name ?? ''])
  );

  // vendor_item_id 기준 grouping
  const byItem = new Map<string, { meta: any; dates: { date: string; qty: number }[] }>();

  for (const row of snapshots ?? []) {
    const key = row.vendor_item_id;
    const isReturn = returnMap.has(key);

    if (!byItem.has(key)) {
      const platformName = row.external_sku_id ? (platformNameMap.get(row.external_sku_id) ?? null) : null;
      byItem.set(key, {
        meta: {
          vendor_item_id:  row.vendor_item_id,
          external_sku_id: row.external_sku_id,
          item_name:       platformName ?? (row as any).item_name ?? null,
          sales_last_30d:  row.sales_last_30d,
          sku_id:          row.sku_id,
          sku:             (row as any).sku,
          is_return:       isReturn,
          grade:           isReturn ? (returnMap.get(key) ?? null) : null,
        },
        dates: [],
      });
    }
    byItem.get(key)!.dates.push({ date: row.snapshot_date, qty: row.total_orderable_qty });
    byItem.get(key)!.meta.sales_last_30d = row.sales_last_30d;
  }

  const result = Array.from(byItem.values()).map(({ meta, dates }) => {
    const dailyChanges = dates.map((d, i) => ({
      date:   d.date,
      qty:    d.qty,
      change: i === 0 ? null : d.qty - dates[i - 1].qty,
    }));

    const latest = dates.at(-1);
    const avgDailySales = meta.sales_last_30d > 0 ? meta.sales_last_30d / 30 : null;
    const daysRemaining = latest && avgDailySales ? Math.floor(latest.qty / avgDailySales) : null;

    return {
      ...meta,
      current_qty:    latest?.qty ?? 0,
      days_remaining: daysRemaining,
      daily:          dailyChanges,
    };
  });

  result.sort((a, b) => a.current_qty - b.current_qty);

  return NextResponse.json(result);
}
