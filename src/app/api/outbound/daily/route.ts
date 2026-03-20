import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/outbound/daily?days=30
// 일자별 채널별 출고 합계 반환
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? '30'), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const admin = await createAdminClient();

  const { data, error } = await admin
    .from('outbound_records')
    .select('outbound_date, quantity, channel:channels(name)')
    .gte('outbound_date', since)
    .order('outbound_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 날짜별 채널별 집계
  const byDate: Record<string, Record<string, number>> = {};
  const channelSet = new Set<string>();

  for (const row of data ?? []) {
    const date = row.outbound_date as string;
    const ch = (row.channel as any)?.name ?? '기타';
    channelSet.add(ch);
    if (!byDate[date]) byDate[date] = {};
    byDate[date][ch] = (byDate[date][ch] ?? 0) + (row.quantity as number);
  }

  // 날짜 채우기: 데이터 없는 날도 0으로 포함
  const result: Array<Record<string, any>> = [];
  const channels = [...channelSet].sort();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const row: Record<string, any> = { date: dateStr, total: 0 };
    for (const ch of channels) {
      row[ch] = byDate[dateStr]?.[ch] ?? 0;
      row.total += row[ch];
    }
    result.push(row);
  }

  return NextResponse.json({ data: result, channels });
}
