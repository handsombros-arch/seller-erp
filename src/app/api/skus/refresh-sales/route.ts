import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// POST /api/skus/refresh-sales
// channel_orders 기반으로 skus.sales_7d / sales_30d 갱신.
// 주문 sync 후 또는 cron으로 호출.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since7  = new Date(Date.now() -  7 * 86400000).toISOString().slice(0, 10);

  // 취소/반품 제외 상태
  const cancelStatuses = [
    'CANCELLED', 'CANCEL', 'CANCEL_DONE',
    'RETURNED', 'RETURN', 'RETURN_DONE',
    'PURCHASE_CANCEL', 'VENDOR_CANCEL',
  ];

  // 최근 30일 주문을 sku_id별로 집계
  const { data: orders, error } = await admin
    .from('channel_orders')
    .select('sku_id, quantity, order_date, order_status')
    .not('sku_id', 'is', null)
    .gte('order_date', since30)
    .not('order_status', 'in', `(${cancelStatuses.map((s) => `"${s}"`).join(',')})`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // sku_id 별 7일/30일 집계
  const bySkuId: Record<string, { s7: number; s30: number }> = {};
  for (const row of orders ?? []) {
    const id = row.sku_id as string;
    if (!bySkuId[id]) bySkuId[id] = { s7: 0, s30: 0 };
    bySkuId[id].s30 += row.quantity as number;
    if ((row.order_date as string) >= since7) {
      bySkuId[id].s7 += row.quantity as number;
    }
  }

  // 배치 업데이트
  let updated = 0;
  const entries = Object.entries(bySkuId);
  for (const [sku_id, { s7, s30 }] of entries) {
    const { error: upErr } = await admin
      .from('skus')
      .update({ sales_7d: s7, sales_30d: s30 })
      .eq('id', sku_id);
    if (!upErr) updated++;
  }

  // 주문 없는 SKU는 0으로 리셋 (선택적)
  // 주문이 있었던 sku_id 목록에 없는 것들을 0으로
  const { error: resetErr } = await admin
    .from('skus')
    .update({ sales_7d: 0, sales_30d: 0 })
    .not('id', 'in', entries.length > 0 ? `(${entries.map(([id]) => `"${id}"`).join(',')})` : '("none")');

  return NextResponse.json({
    updated,
    reset: !resetErr,
    sku_count: entries.length,
  });
}
