import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const skuId = searchParams.get('sku_id');
  const days = Math.min(Number(searchParams.get('days') ?? '30'), 90);

  if (!skuId) return NextResponse.json({ error: 'sku_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await admin
    .from('inventory_adjustments')
    .select('id, sku_id, warehouse_id, before_quantity, after_quantity, reason, created_at, warehouse:warehouses(name)')
    .eq('sku_id', skuId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // reason 파싱해서 유형 + 주문번호 추출
  const results = (data ?? []).map((r: any) => {
    const reason = r.reason ?? '';
    let type: string = '수동';
    let orderNumber: string | null = null;
    let channel: string | null = null;

    if (reason.startsWith('__ORDER__:')) {
      type = '주문 차감';
      orderNumber = reason.slice('__ORDER__:'.length);
    } else if (reason.startsWith('__RESTORE__:')) {
      type = '반품 복구';
      orderNumber = reason.slice('__RESTORE__:'.length);
    } else if (reason.startsWith('__EXCHANGE_RESTORE__:')) {
      type = '교환 복구';
      orderNumber = reason.slice('__EXCHANGE_RESTORE__:'.length);
    } else if (reason.startsWith('__EXCHANGE_DEDUCT__:')) {
      type = '교환 차감';
      orderNumber = reason.slice('__EXCHANGE_DEDUCT__:'.length);
    } else if (reason.startsWith('__PHYSICAL_COUNT__:')) {
      type = '월별 실사';
    } else if (reason === '수동 조정') {
      type = '수동 조정';
    }

    // 주문번호로 채널 추정
    if (orderNumber) {
      if (orderNumber.includes('-')) channel = 'coupang'; // shipmentBoxId-vendorItemId
      else if (orderNumber.length >= 15) channel = 'smartstore';
      else channel = 'toss';
    }

    const change = r.after_quantity - r.before_quantity;

    return {
      id: r.id,
      date: r.created_at,
      type,
      change,
      before: r.before_quantity,
      after: r.after_quantity,
      orderNumber,
      channel,
      warehouse: (r as any).warehouse?.name ?? null,
      reason,
    };
  });

  // 날짜별 그룹핑
  const byDate = new Map<string, typeof results>();
  for (const r of results) {
    const dateKey = r.date.slice(0, 10);
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(r);
  }

  return NextResponse.json({
    history: results,
    byDate: Object.fromEntries(byDate),
    total: results.length,
  });
}
