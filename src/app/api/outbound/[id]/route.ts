import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

type Ctx = { params: Promise<{ id: string }> };

async function getOldRecord(admin: any, id: string) {
  const { data, error } = await admin
    .from('outbound_records')
    .select('sku_id, warehouse_id, quantity')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as { sku_id: string; warehouse_id: string; quantity: number };
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
  const { data, error } = await admin
    .from('outbound_records')
    .update(body)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // 수량이 바뀌었으면 재고 역산: 기존 수량 복구 후 새 수량 차감
  const newQty = body.quantity ?? old.quantity;
  const qtyDelta = old.quantity - newQty; // 양수 = 재고 증가, 음수 = 재고 감소
  await adjustInventory(admin, old.sku_id, old.warehouse_id, qtyDelta);

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
