import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

type Ctx = { params: Promise<{ id: string }> };

async function getOldRecord(admin: any, id: string) {
  const { data, error } = await admin
    .from('outbound_records')
    .select('sku_id, warehouse_id, quantity, status, outbound_type')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as { sku_id: string; warehouse_id: string; quantity: number; status: string; outbound_type: string };
}

async function adjustInventory(admin: any, skuId: string, warehouseId: string, delta: number) {
  if (delta === 0) return;
  const { data: inv } = await admin
    .from('inventory')
    .select('quantity')
    .eq('sku_id', skuId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle();
  const current = inv?.quantity ?? 0;
  await admin
    .from('inventory')
    .upsert(
      { sku_id: skuId, warehouse_id: warehouseId, quantity: Math.max(0, current + delta) },
      { onConflict: 'sku_id,warehouse_id' }
    );
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const old = await getOldRecord(admin, id);
  if (!old) return NextResponse.json({ error: '레코드 없음' }, { status: 404 });

  const body = await request.json();

  // 판매개시: shipped → selling (쿠팡 재고에 추가)
  if (body.status === 'selling' && old.status === 'shipped') {
    body.selling_started_at = body.selling_started_at ?? new Date().toISOString().slice(0, 10);

    // 쿠팡그로스 출고인 경우 → RG 재고 스냅샷에는 자동 반영 (API 동기화)
    // 여기서는 상태만 변경
  }

  // 회송: shipped → returned (자사 창고에 복구)
  if (body.status === 'returned' && old.status === 'shipped') {
    await adjustInventory(admin, old.sku_id, old.warehouse_id, old.quantity);
  }

  const { data, error } = await admin
    .from('outbound_records')
    .update(body)
    .eq('id', id)
    .select('*, sku:skus(sku_code, option_values, product:products(name)), warehouse:warehouses(name), channel:channels(name, type)')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // 일반 수량 변경 (판매개시/회송이 아닌 경우)
  if (!body.status && body.quantity != null) {
    const newQty = body.quantity ?? old.quantity;
    const qtyDelta = old.quantity - newQty;
    await adjustInventory(admin, old.sku_id, old.warehouse_id, qtyDelta);
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const old = await getOldRecord(admin, id);
  if (!old) return NextResponse.json({ error: '레코드 없음' }, { status: 404 });

  const { error } = await admin.from('outbound_records').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // 삭제 시 재고 복구
  await adjustInventory(admin, old.sku_id, old.warehouse_id, old.quantity);

  return NextResponse.json({ ok: true });
}
