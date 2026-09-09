import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/** 정산 설정 (key/value). GET → { settings: {key: value} } · POST { key, value } */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  const { data, error } = await admin.from('settlement_settings').select('key, value');
  if (error) return NextResponse.json({ settings: {}, needsMigration: true, error: error.message });
  return NextResponse.json({ settings: Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value])) });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.key) return NextResponse.json({ error: 'key 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { error } = await admin.from('settlement_settings').upsert({ key: String(body.key), value: body.value == null ? null : String(body.value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
