import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const RETURN_KEYWORDS = ['반품재판매', '반품 재판매', '리퍼'];

// 상품명에서 등급 추출 (S급/A급/B급/C급, 최상/상/중/하, 미개봉 등)
function extractGrade(name: string): string | null {
  if (!name) return null;
  const m =
    name.match(/[SABC]급/i) ??
    name.match(/최상급|최상|미개봉|새상품/) ??
    name.match(/(?<![가-힣])상(?!품|태|자|세|점|장|위|황|권|관|온|온라|표|면|응|자|실|계)/) ??
    name.match(/(?<![가-힣])중(?!고|간|요|심|앙|학|독|력|량|지|단|점|부|하|류)/) ??
    name.match(/(?<![가-힣])하(?!자|단|락|반|계|늘|루|루|지)/);
  return m ? m[0] : null;
}

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

  // vendor_item_id 기준 grouping
  const byItem = new Map<string, { meta: any; dates: { date: string; qty: number }[] }>();

  for (const row of snapshots ?? []) {
    const key = row.vendor_item_id;
    const itemName: string = (row as any).item_name ?? '';
    const isReturn = RETURN_KEYWORDS.some((kw) => itemName.includes(kw));

    if (!byItem.has(key)) {
      byItem.set(key, {
        meta: {
          vendor_item_id:  row.vendor_item_id,
          external_sku_id: row.external_sku_id,
          item_name:       itemName || null,
          sales_last_30d:  row.sales_last_30d,
          sku_id:          row.sku_id,
          sku:             (row as any).sku,
          is_return:       isReturn,
          grade:           isReturn ? extractGrade(itemName) : null,
        },
        dates: [],
      });
    }
    byItem.get(key)!.dates.push({ date: row.snapshot_date, qty: row.total_orderable_qty });
    byItem.get(key)!.meta.sales_last_30d = row.sales_last_30d;
    // item_name이 나중 스냅샷에 채워질 수 있으므로 최신값 유지
    if (itemName) {
      byItem.get(key)!.meta.item_name = itemName;
      byItem.get(key)!.meta.is_return = RETURN_KEYWORDS.some((kw) => itemName.includes(kw));
      byItem.get(key)!.meta.grade = byItem.get(key)!.meta.is_return ? extractGrade(itemName) : null;
    }
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
