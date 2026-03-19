import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('inventory')
    .select(`
      *,
      sku:skus(
        id, sku_code, option_values, cost_price, reorder_point, safety_stock,
        product:products(id, name, category, brand)
      ),
      warehouse:warehouses(id, name, type)
    `)
    .order('updated_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { sku_id, warehouse_id, new_quantity, reason } = body;

  if (!sku_id || !warehouse_id || new_quantity === undefined) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Get current inventory
  const { data: current } = await admin
    .from('inventory')
    .select('quantity')
    .eq('sku_id', sku_id)
    .eq('warehouse_id', warehouse_id)
    .single();

  const old_quantity = current?.quantity ?? 0;
  const adjustment = new_quantity - old_quantity;

  // Insert adjustment record
  await admin.from('inventory_adjustments').insert({
    sku_id,
    warehouse_id,
    before_quantity: old_quantity,
    after_quantity: new_quantity,
    reason: reason ?? '수동 조정',
    adjusted_by: user.id,
  });

  // Upsert inventory
  const { data, error } = await admin
    .from('inventory')
    .upsert({ sku_id, warehouse_id, quantity: new_quantity }, { onConflict: 'sku_id,warehouse_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
