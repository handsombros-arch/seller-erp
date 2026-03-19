import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const q    = searchParams.get('q');

  const admin = await createAdminClient();
  let query = admin
    .from('coupang_returns')
    .select('*, sku:skus(id, sku_code, option_values, product:products(name))')
    .order('returned_at', { ascending: false })
    .limit(500);

  if (from) query = query.gte('returned_at', from);
  if (to)   query = query.lte('returned_at', to);
  if (q)    query = query.ilike('product_name', `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}
