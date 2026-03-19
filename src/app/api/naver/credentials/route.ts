import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data } = await admin
    .from('naver_credentials')
    .select('client_id, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(data ?? null);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { clientId, clientSecret } = await request.json();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'clientId, clientSecret 필수' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // 기존 삭제 후 새로 저장
  await admin.from('naver_credentials').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error } = await admin.from('naver_credentials').insert({
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
