import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const admin = await createAdminClient();
  const { data, error } = await admin.from('skus').update(body).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { id } = await params;
  const admin = await createAdminClient();
  // 재고가 남아 있으면 말없이 사라지므로 막는다 (먼저 조정으로 0 을 만들거나 비활성 처리)
  const { data: inv } = await admin.from('inventory').select('quantity').eq('sku_id', id);
  const stock = (inv ?? []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  if (stock > 0) return NextResponse.json({ error: `재고가 ${stock}개 남아 있어 삭제할 수 없습니다. 재고를 0 으로 조정하거나 비활성 처리하세요.` }, { status: 409 });
  const { error } = await admin.from('skus').delete().eq('id', id);
  if (error) {
    // 23503 = FK 위반: 발주·입출고·재고조정 기록이 참조 중 (이력은 지우지 않는다)
    if (error.code === '23503') return NextResponse.json({ error: '발주·입출고·재고조정 기록이 있는 SKU 는 삭제할 수 없습니다. 대신 비활성 처리하세요.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
