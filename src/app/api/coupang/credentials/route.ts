import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('coupang_credentials')
    .select('id, vendor_id, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // access_key / secret_key는 마스킹해서 반환 (보안)
  if (!data) return NextResponse.json(null);
  return NextResponse.json({ id: data.id, vendor_id: data.vendor_id, updated_at: data.updated_at });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { access_key, secret_key, vendor_id } = await request.json();
  if (!access_key || !secret_key || !vendor_id) {
    return NextResponse.json({ error: '모든 필드를 입력하세요' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // 기존 레코드 삭제 후 재등록 (단일 레코드 유지)
  await admin.from('coupang_credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const { error } = await admin.from('coupang_credentials').insert({
    access_key,
    secret_key,
    vendor_id,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
