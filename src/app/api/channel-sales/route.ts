import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const q = searchParams.get('q');

  const admin = await createAdminClient();
  let query = admin
    .from('channel_sales')
    .select(`*, sku:skus(id, sku_code, option_values, product:products(name), platform_skus(platform_product_name, channel:channels(type)))`)
    .order('sale_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (channel && channel !== 'all') query = query.eq('channel', channel);
  if (from) query = query.gte('sale_date', from);
  if (to)   query = query.lte('sale_date', to);
  if (q)    query = query.ilike('product_name', `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  const { data, error } = await admin
    .from('channel_sales')
    .insert({
      channel: body.channel,
      sku_id: body.sku_id || null,
      product_name: body.product_name,
      option_name: body.option_name || null,
      quantity: Number(body.quantity),
      revenue: Number(body.revenue) || 0,
      sale_date: body.sale_date,
      sale_date_end: body.sale_date_end || null,
      note: body.note || null,
    })
    .select(`*, sku:skus(id, sku_code, option_values, product:products(name), platform_skus(platform_product_name, channel:channels(type)))`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
