import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('inbound_records')
    .select(`
      *,
      sku:skus(
        id, sku_code, option_values,
        product:products(id, name)
      ),
      warehouse:warehouses(id, name)
    `)
    .order('inbound_date', { ascending: false })
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { sku_id, warehouse_id, quantity, unit_cost, inbound_date, note, po_item_id } = body;

  if (!sku_id || !warehouse_id || !quantity || !inbound_date) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Create inbound record (DB trigger will update inventory)
  const { data, error } = await admin
    .from('inbound_records')
    .insert({
      sku_id,
      warehouse_id,
      quantity,
      unit_cost: unit_cost ?? null,
      inbound_date,
      note: note ?? null,
      po_item_id: po_item_id ?? null,
    })
    .select(`
      *,
      sku:skus(id, sku_code, option_values, product:products(id, name)),
      warehouse:warehouses(id, name)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // If linked to a PO item, update received_quantity
  if (po_item_id) {
    const { data: poItem } = await admin
      .from('purchase_order_items')
      .select('received_quantity, quantity, po_id')
      .eq('id', po_item_id)
      .single();

    if (poItem) {
      const newReceived = (poItem.received_quantity ?? 0) + quantity;
      await admin
        .from('purchase_order_items')
        .update({ received_quantity: newReceived })
        .eq('id', po_item_id);

      // Update PO status
      const { data: allItems } = await admin
        .from('purchase_order_items')
        .select('quantity, received_quantity')
        .eq('po_id', poItem.po_id);

      if (allItems) {
        const allComplete = allItems.every((i) => (i.received_quantity ?? 0) >= i.quantity);
        const anyReceived = allItems.some((i) => (i.received_quantity ?? 0) > 0);
        const newStatus = allComplete ? 'completed' : anyReceived ? 'partial' : 'ordered';
        await admin.from('purchase_orders').update({ status: newStatus }).eq('id', poItem.po_id);
      }
    }
  }

  return NextResponse.json(data);
}
