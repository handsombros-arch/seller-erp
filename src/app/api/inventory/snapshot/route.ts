import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// POST /api/inventory/snapshot
// 현재 inventory 테이블 전체를 오늘 날짜로 upsert.
// 입출고가 없는 날에도 대시보드/재고현황 페이지에서 호출하면 스냅샷이 쌓임.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  // CRON 또는 내부 호출 여부 체크 (선택적 secret)
  const secret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    // 인증된 사용자면 허용, 그게 아니면 reject
  }

  const admin = await createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: inventory, error: fetchErr } = await admin
    .from('inventory')
    .select('sku_id, warehouse_id, quantity');

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  if (!inventory || inventory.length === 0) {
    return NextResponse.json({ snapshot_date: today, upserted: 0 });
  }

  const rows = inventory.map((row) => ({
    snapshot_date: today,
    sku_id:        row.sku_id,
    warehouse_id:  row.warehouse_id,
    quantity:      row.quantity,
  }));

  const { error: upsertErr } = await admin
    .from('inventory_snapshots')
    .upsert(rows, { onConflict: 'snapshot_date,sku_id,warehouse_id', ignoreDuplicates: false });

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  return NextResponse.json({ snapshot_date: today, upserted: rows.length });
}

// GET /api/inventory/snapshot?days=30
// 일자별 총 재고 합계 (변화 추이용)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? '30'), 365);
  const sku_id = request.nextUrl.searchParams.get('sku_id');

  const admin = await createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  let query = admin
    .from('inventory_snapshots')
    .select('snapshot_date, sku_id, warehouse_id, quantity, sku:skus(sku_code, product:products(name)), warehouse:warehouses(name)')
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: true });

  if (sku_id) query = query.eq('sku_id', sku_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 날짜별 총합 (전체 SKU 합산)
  const dailyTotals: Record<string, number> = {};
  for (const row of data ?? []) {
    dailyTotals[row.snapshot_date] = (dailyTotals[row.snapshot_date] ?? 0) + row.quantity;
  }

  // SKU별 날짜 배열 (개별 SKU 조회 시)
  const bySkuWarehouse: Record<string, { meta: any; daily: { date: string; qty: number; change: number | null }[] }> = {};
  if (sku_id) {
    for (const row of data ?? []) {
      const key = `${row.sku_id}__${row.warehouse_id}`;
      if (!bySkuWarehouse[key]) {
        bySkuWarehouse[key] = {
          meta: { sku: (row as any).sku, warehouse: (row as any).warehouse, warehouse_id: row.warehouse_id },
          daily: [],
        };
      }
      bySkuWarehouse[key].daily.push({ date: row.snapshot_date, qty: row.quantity, change: null });
    }
    // diff 계산
    for (const entry of Object.values(bySkuWarehouse)) {
      entry.daily = entry.daily.map((d, i) => ({
        ...d,
        change: i === 0 ? null : d.qty - entry.daily[i - 1].qty,
      }));
    }
  }

  return NextResponse.json({
    days,
    daily_totals: Object.entries(dailyTotals).map(([date, qty]) => ({ date, qty })),
    by_warehouse: sku_id ? Object.values(bySkuWarehouse) : [],
  });
}
