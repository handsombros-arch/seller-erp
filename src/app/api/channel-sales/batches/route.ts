import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // batch_id 있는 레코드만 가져와서 배치 단위로 집계
  const { data, error } = await admin
    .from('channel_sales')
    .select('batch_id, sale_date, sale_date_end, created_at, channel')
    .not('batch_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Group by batch_id
  const batchMap = new Map<string, {
    batch_id: string;
    period_start: string;
    period_end: string;
    row_count: number;
    uploaded_at: string;
    channels: string[];
  }>();

  for (const row of data ?? []) {
    const bid = row.batch_id as string;
    const end = (row.sale_date_end ?? row.sale_date) as string;
    const existing = batchMap.get(bid);
    if (!existing) {
      batchMap.set(bid, {
        batch_id: bid,
        period_start: row.sale_date as string,
        period_end: end,
        row_count: 1,
        uploaded_at: row.created_at as string,
        channels: [row.channel as string],
      });
    } else {
      existing.row_count++;
      if ((row.sale_date as string) < existing.period_start) existing.period_start = row.sale_date as string;
      if (end > existing.period_end) existing.period_end = end;
      if (!existing.channels.includes(row.channel as string)) existing.channels.push(row.channel as string);
    }
  }

  const batches = [...batchMap.values()]
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
    .slice(0, 15);

  return NextResponse.json(batches);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const batch_id = searchParams.get('batch_id');
  if (!batch_id) return NextResponse.json({ error: 'batch_id 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const { error } = await admin.from('channel_sales').delete().eq('batch_id', batch_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
