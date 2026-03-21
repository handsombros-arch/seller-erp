import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const today = new Date();
  const d30ago = new Date(today); d30ago.setDate(today.getDate() - 30);
  const d7ago  = new Date(today); d7ago.setDate(today.getDate() - 7);
  const from30 = d30ago.toISOString().slice(0, 10);
  const from7  = d7ago.toISOString().slice(0, 10);
  const toDate = today.toISOString().slice(0, 10);

  // ── 1. 쿠팡 그로스 주문 조회 (30일치)
  const { data: orders } = await admin
    .from('channel_orders')
    .select('id, product_name, option_name, sku_id, quantity, order_date')
    .in('channel', ['coupang_rg', 'coupang', 'coupang_growth'])
    .gte('order_date', from30)
    .lte('order_date', toDate);

  if (!orders?.length) {
    return NextResponse.json({ updated: 0, matched_new: 0, unmatched: 0 });
  }

  // ── 2. SKU 매칭 (옵션 포함)
  const { buildSkuMatcher } = await import('@/lib/inventory/matchSku');
  const matcher = await buildSkuMatcher(admin);

  // ── 3. 미매칭 주문에 대해 매칭 후 sku_id 업데이트
  const toUpdate: { id: string; sku_id: string }[] = [];
  let unmatched = 0;

  for (const order of orders) {
    if (order.sku_id) continue;

    const matchedSkuId = matcher.byNameOption(order.product_name ?? '', order.option_name);

    if (matchedSkuId) {
      toUpdate.push({ id: order.id, sku_id: matchedSkuId });
    } else {
      unmatched++;
    }
  }

  // 배치 업데이트 (최대 100건씩)
  let matchedNew = 0;
  for (let i = 0; i < toUpdate.length; i += 100) {
    const batch = toUpdate.slice(i, i + 100);
    for (const row of batch) {
      await admin.from('channel_orders').update({ sku_id: row.sku_id }).eq('id', row.id);
    }
    matchedNew += batch.length;
  }

  // ── 5. 매칭된 주문 재조회 (sku_id 있는 것만)
  const { data: matchedOrders } = await admin
    .from('channel_orders')
    .select('sku_id, quantity, order_date')
    .eq('channel', 'coupang_growth')
    .gte('order_date', from30)
    .lte('order_date', toDate)
    .not('sku_id', 'is', null);

  // ── 6. SKU별 7d / 30d 집계
  const sales7d:  Record<string, number> = {};
  const sales30d: Record<string, number> = {};

  for (const o of matchedOrders ?? []) {
    const skuId = o.sku_id as string;
    const qty   = Number(o.quantity ?? 0);

    sales30d[skuId] = (sales30d[skuId] ?? 0) + qty;
    if (o.order_date >= from7) {
      sales7d[skuId] = (sales7d[skuId] ?? 0) + qty;
    }
  }

  // ── 7. skus 테이블 업데이트
  const allSkuIds = [...new Set([...Object.keys(sales7d), ...Object.keys(sales30d)])];
  let updated = 0;

  for (const skuId of allSkuIds) {
    const { error } = await admin
      .from('skus')
      .update({
        sales_7d:  sales7d[skuId]  ?? 0,
        sales_30d: sales30d[skuId] ?? 0,
      })
      .eq('id', skuId);

    if (!error) updated++;
  }

  return NextResponse.json({ updated, matched_new: matchedNew, unmatched });
}
