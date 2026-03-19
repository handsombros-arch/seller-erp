import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const channel  = searchParams.get('channel');
  const from     = searchParams.get('from');
  const to       = searchParams.get('to');
  const statuses = searchParams.getAll('status');   // multiple allowed
  const q        = searchParams.get('q');

  const admin = await createAdminClient();
  let query = admin
    .from('channel_orders')
    .select('*, sku:skus(id, sku_code, option_values, product:products(name), platform_skus(platform_product_name, channel:channels(type)))')
    .order('order_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (channel && channel !== 'all') query = query.eq('channel', channel);
  if (from) query = query.gte('order_date', from);
  if (to)   query = query.lte('order_date', to);
  if (statuses.length) query = query.in('order_status', statuses);
  if (q) query = query.or(`product_name.ilike.%${q}%,order_number.ilike.%${q}%,recipient.ilike.%${q}%`);

  const { data, error } = await query.limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel'); // 없으면 전체 삭제

  const admin = await createAdminClient();
  let query = admin.from('channel_orders').delete();
  if (channel && channel !== 'all') {
    query = query.eq('channel', channel);
  } else {
    query = query.neq('id', '00000000-0000-0000-0000-000000000000'); // 전체 삭제
  }

  const { error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: count ?? 0 });
}
