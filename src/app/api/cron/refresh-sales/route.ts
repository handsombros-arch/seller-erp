import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * 판매량 갱신 핵심 로직 (직접 호출용)
 */
export async function runRefreshSales(): Promise<Record<string, any>> {
  const admin = await createAdminClient();

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since7  = new Date(Date.now() -  7 * 86400000).toISOString().slice(0, 10);

  const cancelStatuses = [
    'CANCELLED', 'CANCEL', 'CANCEL_DONE',
    'RETURNED', 'RETURN', 'RETURN_DONE',
    'PURCHASE_CANCEL', 'VENDOR_CANCEL',
  ];

  // cancelled_at 세팅된 주문 (트리거가 UPDATE 로 복구한 케이스) 도 추가로 제외.
  // 이전엔 order_status 만 보고 매출 카운트 → 취소 후 status 변경 안 된 일부 케이스에서
  // 매출 카운트 계속 유지되던 문제 fix.
  const { data: orders, error } = await admin
    .from('channel_orders')
    .select('sku_id, quantity, order_date, order_status, cancelled_at')
    .not('sku_id', 'is', null)
    .gte('order_date', since30)
    .is('cancelled_at', null)
    .not('order_status', 'in', `(${cancelStatuses.map((s) => `"${s}"`).join(',')})`);

  if (error) {
    console.error('[cron/refresh-sales]', error.message);
    return { error: error.message };
  }

  const bySkuId: Record<string, { s7: number; s30: number }> = {};
  for (const row of orders ?? []) {
    const id = row.sku_id as string;
    if (!bySkuId[id]) bySkuId[id] = { s7: 0, s30: 0 };
    bySkuId[id].s30 += row.quantity as number;
    if ((row.order_date as string) >= since7) {
      bySkuId[id].s7 += row.quantity as number;
    }
  }

  let updated = 0;
  const skuIds = Object.keys(bySkuId);
  for (const sku_id of skuIds) {
    const { s7, s30 } = bySkuId[sku_id];
    const { error: upErr } = await admin
      .from('skus')
      .update({ sales_7d: s7, sales_30d: s30 })
      .eq('id', sku_id);
    if (!upErr) updated++;
  }

  // 최근 30일 주문 없는 SKU → 0 리셋
  if (skuIds.length > 0) {
    await admin
      .from('skus')
      .update({ sales_7d: 0, sales_30d: 0 })
      .not('id', 'in', `(${skuIds.map((id) => `"${id}"`).join(',')})`);
  }

  console.log(`[cron/refresh-sales] updated ${updated} SKUs`);
  return { ok: true, updated, sku_count: skuIds.length };
}

/**
 * HTTP 엔드포인트 (수동 트리거용)
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runRefreshSales();
  return NextResponse.json(result);
}
