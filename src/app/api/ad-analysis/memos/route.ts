import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const VALID_CHANNELS = ['coupang', 'toss', 'smartstore'] as const;
type Channel = typeof VALID_CHANNELS[number];
function normalizeChannel(input: unknown): Channel {
  const v = typeof input === 'string' ? input.toLowerCase() : '';
  return (VALID_CHANNELS as readonly string[]).includes(v) ? (v as Channel) : 'coupang';
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const channel = normalizeChannel(request.nextUrl.searchParams.get('channel'));
  const admin = await createAdminClient();
  const { data } = await admin
    .from('ad_memos')
    .select('date, memo')
    .eq('channel', channel)
    .order('date', { ascending: false });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { date, memo } = body;
  const channel = normalizeChannel(body.channel);
  if (!date) return NextResponse.json({ error: 'date 필요' }, { status: 400 });

  const admin = await createAdminClient();
  if (!memo?.trim()) {
    await admin.from('ad_memos').delete().eq('date', date).eq('channel', channel);
    return NextResponse.json({ ok: true, deleted: date, channel });
  }
  await admin.from('ad_memos').upsert(
    { date, channel, memo: memo.trim(), updated_at: new Date().toISOString() },
    { onConflict: 'date,channel' },
  );
  return NextResponse.json({ ok: true });
}
