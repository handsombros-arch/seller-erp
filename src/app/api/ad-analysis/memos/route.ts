import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin.from('ad_memos').select('date, memo').order('date', { ascending: false });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { date, memo } = await request.json();
  if (!date) return NextResponse.json({ error: 'date 필요' }, { status: 400 });

  const admin = await createAdminClient();
  if (!memo?.trim()) {
    await admin.from('ad_memos').delete().eq('date', date);
    return NextResponse.json({ ok: true, deleted: date });
  }
  await admin.from('ad_memos').upsert({ date, memo: memo.trim(), updated_at: new Date().toISOString() }, { onConflict: 'date' });
  return NextResponse.json({ ok: true });
}
