import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const EXCHANGE_RESTORE = '__EXCHANGE_RESTORE__:';
const EXCHANGE_DEDUCT  = '__EXCHANGE_DEDUCT__:';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { order_number, original_sku_id, replacement_sku_id, quantity } = await request.json();
  if (!order_number || !original_sku_id || !replacement_sku_id) {
    return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const qty = Number(quantity) || 1;

  // 이미 처리된 교환인지 확인
  const { data: existing } = await admin
    .from('inventory_adjustments')
    .select('id')
    .eq('reason', `${EXCHANGE_RESTORE}${order_number}`)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: '이미 처리된 교환입니다' }, { status: 400 });
  }

  // 기본 창고
  const { data: whs } = await admin.from('warehouses').select('id').limit(1);
  const defaultWhId = (whs?.[0] as any)?.id;
  if (!defaultWhId) return NextResponse.json({ error: '창고가 없습니다' }, { status: 400 });

  // 1. 원래 상품 재고 복구 (+qty)
  const { data: origInv } = await admin
    .from('inventory')
    .select('quantity, warehouse_id')
    .eq('sku_id', original_sku_id)
    .limit(1)
    .maybeSingle();

  const origWh = origInv?.warehouse_id ?? defaultWhId;
  const origBefore = origInv?.quantity ?? 0;
  const origAfter = origBefore + qty;

  await admin.from('inventory').upsert(
    { sku_id: original_sku_id, warehouse_id: origWh, quantity: origAfter },
    { onConflict: 'sku_id,warehouse_id' }
  );
  await admin.from('inventory_adjustments').insert({
    sku_id: original_sku_id, warehouse_id: origWh,
    before_quantity: origBefore, after_quantity: origAfter,
    reason: `${EXCHANGE_RESTORE}${order_number}`, adjusted_by: user.id,
  });

  // 2. 교환 상품 재고 차감 (-qty)
  const { data: replInv } = await admin
    .from('inventory')
    .select('quantity, warehouse_id')
    .eq('sku_id', replacement_sku_id)
    .limit(1)
    .maybeSingle();

  const replWh = replInv?.warehouse_id ?? defaultWhId;
  const replBefore = replInv?.quantity ?? 0;
  const replAfter = replBefore - qty;

  await admin.from('inventory').upsert(
    { sku_id: replacement_sku_id, warehouse_id: replWh, quantity: replAfter },
    { onConflict: 'sku_id,warehouse_id' }
  );
  await admin.from('inventory_adjustments').insert({
    sku_id: replacement_sku_id, warehouse_id: replWh,
    before_quantity: replBefore, after_quantity: replAfter,
    reason: `${EXCHANGE_DEDUCT}${order_number}`, adjusted_by: user.id,
  });

  return NextResponse.json({
    restored: { sku_id: original_sku_id, before: origBefore, after: origAfter },
    deducted: { sku_id: replacement_sku_id, before: replBefore, after: replAfter },
  });
}
