import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('outbound_records')
    .select('*, sku:skus(sku_code, option_values, product:products(name)), warehouse:warehouses(name), channel:channels(name, type)')
    .order('outbound_date', { ascending: false })
    .limit(200);

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('outbound_records')
    .insert({ ...body, created_by: user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // DB 트리거(trg_outbound_update_inventory)가 재고를 자동 차감함
  // 단, inventory 행이 없으면 트리거의 UPDATE가 무시되므로 행이 없을 때만 생성
  const { sku_id, warehouse_id, quantity } = body;
  if (sku_id && warehouse_id && quantity) {
    const { data: inv } = await admin
      .from('inventory')
      .select('id')
      .eq('sku_id', sku_id)
      .eq('warehouse_id', warehouse_id)
      .maybeSingle();
    if (!inv) {
      // 행이 없을 때만 생성 (트리거가 이미 차감했으므로 차감 후 값으로 초기화)
      await admin
        .from('inventory')
        .insert({ sku_id, warehouse_id, quantity: 0 });
    }
  }

  return NextResponse.json(data);
}
