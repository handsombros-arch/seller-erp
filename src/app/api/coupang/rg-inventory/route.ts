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

  // 스냅샷 목록 (날짜 오름차순)
  const { data: snapshots, error } = await admin
    .from('rg_inventory_snapshots')
    .select('snapshot_date, vendor_item_id, external_sku_id, total_orderable_qty, sales_last_30d, sku_id, sku:skus(sku_code, product:products(name))')
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // vendor_item_id 기준으로 grouping → 날짜별 수량 배열 생성
  const byItem = new Map<string, { meta: any; dates: { date: string; qty: number }[] }>();

  for (const row of snapshots ?? []) {
    const key = row.vendor_item_id;
    if (!byItem.has(key)) {
      byItem.set(key, {
        meta: {
          vendor_item_id:  row.vendor_item_id,
          external_sku_id: row.external_sku_id,
          sales_last_30d:  row.sales_last_30d,
          sku_id:          row.sku_id,
          sku:             (row as any).sku,
        },
        dates: [],
      });
    }
    byItem.get(key)!.dates.push({ date: row.snapshot_date, qty: row.total_orderable_qty });
    // 최신 sales_last_30d 갱신
    byItem.get(key)!.meta.sales_last_30d = row.sales_last_30d;
  }

  // 일자별 변동(diff) 계산
  const result = Array.from(byItem.values()).map(({ meta, dates }) => {
    const dailyChanges = dates.map((d, i) => ({
      date:    d.date,
      qty:     d.qty,
      // 전일 대비 변동 (음수 = 출고, 양수 = 입고)
      change:  i === 0 ? null : d.qty - dates[i - 1].qty,
    }));

    const latest = dates.at(-1);
    // 일평균 출고 = 최근 30일 판매량 / 30
    const avgDailySales = meta.sales_last_30d > 0 ? meta.sales_last_30d / 30 : null;
    const daysRemaining = latest && avgDailySales ? Math.floor(latest.qty / avgDailySales) : null;

    return {
      ...meta,
      current_qty:    latest?.qty ?? 0,
      days_remaining: daysRemaining,
      daily:          dailyChanges,
    };
  });

  // current_qty 기준 정렬 (재고 적은 순이 위험도 높음)
  result.sort((a, b) => a.current_qty - b.current_qty);

  return NextResponse.json(result);
}
