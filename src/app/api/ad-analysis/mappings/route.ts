import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 저장된 매핑 조회
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('ad_product_mappings')
    .select('*')
    .order('confirmed_at', { ascending: false });

  return NextResponse.json({ mappings: data ?? [] });
}

// POST: 매핑 저장 (확인된 것만)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { mappings } = await request.json() as {
    mappings: {
      ad_product_name: string;
      matched_name: string;
      price: number;
      cost_price: number;
      commission_rate: number;
      sku_code: string;
    }[];
  };

  if (!mappings?.length) return NextResponse.json({ error: '매핑 없음' }, { status: 400 });

  const rows = mappings.map((m) => ({
    ad_product_name: m.ad_product_name,
    matched_name: m.matched_name,
    price: m.price,
    cost_price: m.cost_price,
    commission_rate: m.commission_rate,
    sku_code: m.sku_code,
    confirmed_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from('ad_product_mappings')
    .upsert(rows, { onConflict: 'ad_product_name' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: rows.length });
}

// DELETE: 매핑 삭제
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { name } = await request.json() as { name: string };

  await admin.from('ad_product_mappings').delete().eq('ad_product_name', name);
  return NextResponse.json({ ok: true });
}
