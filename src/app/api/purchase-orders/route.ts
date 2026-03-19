import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('purchase_orders')
    .select(`
      *,
      items:purchase_order_items(
        *,
        sku:skus(id, sku_code, option_values, product:products(id, name))
      )
    `)
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { supplier, order_date, expected_date, note, items, inbound_type } = body;

  const admin = await createAdminClient();

  // Generate PO number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { count } = await admin
    .from('purchase_orders')
    .select('*', { count: 'exact', head: true });
  const poNumber = `PO-${dateStr}-${String((count ?? 0) + 1).padStart(3, '0')}`;

  // Calculate total amount
  const totalAmount = (items ?? []).reduce(
    (sum: number, item: { quantity: number; unit_cost: number }) =>
      sum + (item.quantity ?? 0) * (item.unit_cost ?? 0),
    0
  );

  // Insert PO
  const { data: po, error: poError } = await admin
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      supplier: supplier ?? null,
      status: 'draft',
      inbound_type: inbound_type ?? 'import',
      order_date: order_date ?? null,
      expected_date: expected_date ?? null,
      total_amount: totalAmount,
      note: note ?? null,
    })
    .select()
    .single();

  if (poError) return NextResponse.json({ error: poError.message }, { status: 400 });

  // Insert items
  if (items && items.length > 0) {
    const itemRows = items.map((item: { sku_id: string; quantity: number; unit_cost: number }) => ({
      po_id: po.id,
      sku_id: item.sku_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      received_quantity: 0,
    }));

    const { error: itemsError } = await admin.from('purchase_order_items').insert(itemRows);
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }

  // Return full PO with items
  const { data: fullPO } = await admin
    .from('purchase_orders')
    .select(`
      *,
      items:purchase_order_items(
        *,
        sku:skus(id, sku_code, option_values, product:products(id, name))
      )
    `)
    .eq('id', po.id)
    .single();

  return NextResponse.json(fullPO);
}
