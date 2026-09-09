import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * 월 마감 상태.
 * GET  → { closed: [{ year_month, closed_at, note }] }   (테이블 없으면 needsMigration)
 * POST { year_month, closed: true|false, note? } → 마감 / 해제
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  const { data, error } = await admin.from('settlement_months').select('year_month, closed_at, note').order('year_month', { ascending: false });
  if (error) return NextResponse.json({ closed: [], needsMigration: /does not exist|schema cache|PGRST205/i.test(error.message), error: error.message });
  return NextResponse.json({ closed: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ym = String(body.year_month ?? '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month 필요' }, { status: 400 });
  const admin = await createAdminClient();
  if (body.closed) {
    const { error } = await admin.from('settlement_months').upsert({ year_month: ym, closed_at: new Date().toISOString(), closed_by: user.id, note: body.note ?? null }, { onConflict: 'year_month' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, closed: true });
  }
  const { error } = await admin.from('settlement_months').delete().eq('year_month', ym);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, closed: false });
}
