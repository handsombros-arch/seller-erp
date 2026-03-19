import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { channel, sale_date, sale_date_end, records } = body;

  if (!channel || !sale_date || !records?.length) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const batch_id = randomUUID();

  const rows = records.map((r: {
    channel?: string; sku_id?: string; product_name: string; option_name?: string;
    quantity: number; revenue?: number;
  }) => ({
    channel: r.channel || channel,  // per-row channel overrides global
    sku_id: r.sku_id || null,
    product_name: r.product_name,
    option_name: r.option_name || null,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue) || 0,
    sale_date,
    sale_date_end: sale_date_end || null,
    batch_id,
  }));

  const { data, error } = await admin.from('channel_sales').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ inserted: data?.length ?? 0, batch_id });
}
