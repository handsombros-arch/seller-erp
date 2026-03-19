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
    .select('id, product_name, sku_id, quantity, order_date')
    .eq('channel', 'coupang_growth')
    .gte('order_date', from30)
    .lte('order_date', toDate);

  if (!orders?.length) {
    return NextResponse.json({ updated: 0, matched_new: 0, unmatched: 0 });
  }

  // ── 2. sku_name_aliases 로드 (product_name → sku_id 매핑)
  const { data: aliases } = await admin
    .from('sku_name_aliases')
    .select('channel_name, sku_id');

  const aliasMap = new Map<string, string>(
    (aliases ?? []).map((a: any) => [a.channel_name.trim().toLowerCase(), a.sku_id])
  );

  // ── 3. sku_code 직접 매칭을 위한 SKU 목록
  const { data: skuList } = await admin.from('skus').select('id, sku_code');
  const skuCodeMap = new Map<string, string>(
    (skuList ?? []).map((s: any) => [s.sku_code.trim().toLowerCase(), s.id])
  );

  // ── 4. 미매칭 주문에 대해 alias 매칭 후 sku_id 업데이트
  const toUpdate: { id: string; sku_id: string }[] = [];
  let unmatched = 0;

  for (const order of orders) {
    if (order.sku_id) continue; // 이미 매칭됨

    const key = (order.product_name ?? '').trim().toLowerCase();
    const matchedSkuId = aliasMap.get(key) ?? skuCodeMap.get(key) ?? null;

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
