import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('snapshot_keywords')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data || []).map((k) => k.id);
  let countByKw: Record<string, number> = {};
  if (ids.length) {
    const { data: snaps } = await admin
      .from('keyword_snapshots')
      .select('keyword_id')
      .in('keyword_id', ids);
    for (const s of snaps || []) countByKw[s.keyword_id] = (countByKw[s.keyword_id] || 0) + 1;
  }
  return NextResponse.json({ keywords: data || [], snapshotCounts: countByKw });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const keyword = String(body.keyword || '').trim();
  const topN = Math.max(10, Math.min(200, Number(body.top_n) || 40));
  const auto = body.auto_interval_minutes != null && body.auto_interval_minutes !== ''
    ? Math.max(5, Number(body.auto_interval_minutes))
    : null;

  if (!keyword) return NextResponse.json({ error: 'keyword 필수' }, { status: 400 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('snapshot_keywords')
    .insert({
      user_id: user.id,
      platform: 'coupang',
      keyword,
      top_n: topN,
      auto_interval_minutes: auto,
      status: 'queued',
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: '이미 등록된 키워드입니다.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
