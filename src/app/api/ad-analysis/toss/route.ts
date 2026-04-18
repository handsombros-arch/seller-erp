import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 저장된 토스 광고 데이터 조회
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('toss_ad_rows')
    .select('data')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: (data ?? []).map((r: any) => r.data) });
}

// POST: 새 행 누적 저장 (dedup_key 기준)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { rows, filename } = await req.json();
  if (!Array.isArray(rows)) return NextResponse.json({ error: 'rows array required' }, { status: 400 });

  const admin = await createAdminClient();
  const payload = rows.map((r: any) => ({
    dedup_key: `${user.id}|${r['일자']}|${r['광고 ID'] ?? ''}|${r['옵션 ID'] ?? ''}`,
    data: r,
    filename: filename || 'toss-upload',
    user_id: user.id,
  }));

  // upsert (중복 스킵)
  const { error } = await admin.from('toss_ad_rows').upsert(payload, { onConflict: 'dedup_key', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: payload.length });
}

// DELETE: 사용자 전체 삭제 (재업로드 전 리셋)
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { error } = await admin.from('toss_ad_rows').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
