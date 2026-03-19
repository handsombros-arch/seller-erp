import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const skuId = request.nextUrl.searchParams.get('sku_id');
  const admin = await createAdminClient();

  let query = admin
    .from('platform_skus')
    .select('*, channel:channels(id, name, type), sku:skus(id, sku_code, product:products(name))');

  if (skuId) query = query.eq('sku_id', skuId);

  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  // upsert: sku_id + channel_id 조합이 이미 있으면 업데이트
  const { data, error } = await admin
    .from('platform_skus')
    .upsert(body, { onConflict: 'sku_id,channel_id' })
    .select('*, channel:channels(id, name, type)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
