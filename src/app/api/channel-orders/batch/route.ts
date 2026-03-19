import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { channel, records } = body as {
    channel: string;
    records: {
      order_date: string; product_name: string; option_name?: string;
      order_number?: string; recipient?: string; quantity: number;
      shipping_cost: number; orig_shipping: number; jeju_surcharge: boolean;
      tracking_number?: string; order_status?: string; address?: string;
      sku_id?: string;
    }[];
  };

  if (!channel || !records?.length) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const batch_id = randomUUID();

  const rows = records.map((r) => ({
    channel,
    order_date:      r.order_date,
    product_name:    r.product_name,
    option_name:     r.option_name || null,
    order_number:    r.order_number || null,
    recipient:       r.recipient || null,
    quantity:        Number(r.quantity) || 1,
    shipping_cost:   Number(r.shipping_cost) || 0,
    orig_shipping:   Number(r.orig_shipping) || 0,
    jeju_surcharge:  !!r.jeju_surcharge,
    tracking_number: r.tracking_number || null,
    order_status:    r.order_status || null,
    address:         r.address || null,
    sku_id:          r.sku_id || null,
    batch_id,
  }));

  const { data, error } = await admin.from('channel_orders').insert(rows).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ inserted: data?.length ?? 0, batch_id });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const batch_id = searchParams.get('batch_id');
  if (!batch_id) return NextResponse.json({ error: 'batch_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const { error } = await admin.from('channel_orders').delete().eq('batch_id', batch_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
