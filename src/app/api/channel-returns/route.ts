import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from    = searchParams.get('from');
  const to      = searchParams.get('to');
  const q       = searchParams.get('q');
  const channel = searchParams.get('channel') ?? 'all';

  const admin = await createAdminClient();
  const results: any[] = [];

  // ── 1. 스마트스토어 / 토스: channel_orders에서 반품·취소 주문 ─────────────
  const needOrders = channel === 'all' || channel === 'smartstore' || channel === 'toss';
  if (needOrders) {
    let q2 = admin
      .from('channel_orders')
      .select('id, channel, order_date, order_number, product_name, option_name, quantity, order_status, claim_status, claim_type, sku_id, sku:skus(id, sku_code, product:products(name))')
      .order('order_date', { ascending: false })
      .limit(500);

    if (channel === 'smartstore') q2 = q2.eq('channel', 'smartstore');
    else if (channel === 'toss')  q2 = q2.eq('channel', 'toss');
    else                           q2 = q2.in('channel', ['smartstore', 'toss']);

    if (from) q2 = q2.gte('order_date', from);
    if (to)   q2 = q2.lte('order_date', to);
    if (q)    q2 = q2.ilike('product_name', `%${q}%`);

    // 클레임이 있거나, 취소/반품 상태 코드인 것만
    q2 = q2.or('claim_type.not.is.null,order_status.ilike.%CANCEL%,order_status.ilike.%RETURN%');

    const { data } = await q2;
    for (const row of data ?? []) {
      const isCancelByStatus = (row.order_status ?? '').toUpperCase().includes('CANCEL');
      results.push({
        id:            row.id,
        channel:       row.channel,
        returned_at:   row.order_date,
        product_name:  row.product_name,
        option_name:   row.option_name,
        quantity:      row.quantity,
        return_reason: null,
        return_type:   row.claim_type ?? (isCancelByStatus ? 'CANCEL' : 'RETURN'),
        status:        row.claim_status ?? row.order_status,
        order_number:  row.order_number,
        sku_id:        row.sku_id,
        sku:           row.sku,
      });
    }
  }

  // ── 2. 쿠팡: coupang_returns ──────────────────────────────────────────────
  if (channel === 'all' || channel === 'coupang') {
    let q3 = admin
      .from('coupang_returns')
      .select('*, sku:skus(id, sku_code, product:products(name))')
      .order('returned_at', { ascending: false })
      .limit(500);

    if (from) q3 = q3.gte('returned_at', from);
    if (to)   q3 = q3.lte('returned_at', to);
    if (q)    q3 = q3.ilike('product_name', `%${q}%`);

    const { data } = await q3;
    for (const row of data ?? []) {
      results.push({
        id:            row.id,
        channel:       'coupang',
        returned_at:   row.returned_at,
        product_name:  row.product_name,
        option_name:   row.option_name,
        quantity:      row.quantity,
        return_reason: row.return_reason,
        return_type:   row.return_type,
        status:        row.status,
        order_number:  row.order_id ? String(row.order_id) : null,
        sku_id:        row.sku_id,
        sku:           row.sku,
      });
    }
  }

  results.sort((a, b) => b.returned_at.localeCompare(a.returned_at));
  return NextResponse.json(results);
}
