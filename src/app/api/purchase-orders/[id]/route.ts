import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

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
