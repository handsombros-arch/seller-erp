import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { id } = await params;
  const admin = await createAdminClient();

  // 1. 발주서의 품목 ID 목록 조회
  const { data: poItems } = await admin
    .from('purchase_order_items')
    .select('id')
    .eq('po_id', id);

  const poItemIds = (poItems ?? []).map((i: { id: string }) => i.id);

  // 2. 연결된 입고 기록 조회 (재고 복원용)
  if (poItemIds.length > 0) {
    const { data: inboundRecords } = await admin
      .from('inbound_records')
      .select('sku_id, warehouse_id, quantity')
      .in('po_item_id', poItemIds);

    // 3. 입고된 수량만큼 재고에서 차감 (SKU+창고별 합산 후 한번에 차감)
    if (inboundRecords && inboundRecords.length > 0) {
      const qtyMap = new Map<string, { sku_id: string; warehouse_id: string; total: number }>();
      for (const rec of inboundRecords) {
        const key = `${rec.sku_id}_${rec.warehouse_id}`;
        const existing = qtyMap.get(key);
        if (existing) {
          existing.total += rec.quantity;
        } else {
          qtyMap.set(key, { sku_id: rec.sku_id, warehouse_id: rec.warehouse_id, total: rec.quantity });
        }
      }

      for (const { sku_id, warehouse_id, total } of qtyMap.values()) {
        // 현재 재고 조회
        const { data: inv } = await admin
          .from('inventory')
          .select('quantity')
          .eq('sku_id', sku_id)
          .eq('warehouse_id', warehouse_id)
          .single();

        if (inv) {
          const newQty = Math.max((inv.quantity ?? 0) - total, 0);
          await admin
            .from('inventory')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('sku_id', sku_id)
            .eq('warehouse_id', warehouse_id);
        }
      }
    }

    // 4. 입고 기록 삭제 (po_item FK 해제)
    await admin
      .from('inbound_records')
      .delete()
      .in('po_item_id', poItemIds);
  }

  // 5. 품목 삭제 후 발주서 삭제
  await admin.from('purchase_order_items').delete().eq('po_id', id);
  const { error } = await admin.from('purchase_orders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const admin = await createAdminClient();

  // 완료 처리 시 실제 입고일을 expected_date로 업데이트
  if (body.status === 'completed') {
    const { data: poItems } = await admin
      .from('purchase_order_items')
      .select('id')
      .eq('po_id', id);
    if (poItems && poItems.length > 0) {
      const { data: inboundRows } = await admin
        .from('inbound_records')
        .select('inbound_date')
        .in('po_item_id', poItems.map((i: { id: string }) => i.id))
        .order('inbound_date', { ascending: false })
        .limit(1);
      const latestDate = Array.isArray(inboundRows) ? inboundRows[0]?.inbound_date : null;
      body.expected_date = latestDate ?? new Date().toISOString().slice(0, 10);
    } else {
      body.expected_date = new Date().toISOString().slice(0, 10);
    }
  }

  const { data, error } = await admin
    .from('purchase_orders')
    .update(body)
    .eq('id', id)
    .select(`
      *,
      items:purchase_order_items(
        *,
        sku:skus(id, sku_code, option_values, product:products(id, name))
      )
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
