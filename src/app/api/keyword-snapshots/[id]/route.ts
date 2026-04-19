import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: kw } = await admin
    .from('snapshot_keywords')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!kw || kw.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: snaps } = await admin
    .from('keyword_snapshots')
    .select('id, checked_at, top_n, items_count, error')
    .eq('keyword_id', id)
    .order('checked_at', { ascending: false })
    .limit(200);

  return NextResponse.json({ keyword: kw, snapshots: snaps || [] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const admin = await createAdminClient();

  const { data: row } = await admin
    .from('snapshot_keywords')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (body.action === 'queue') {
    const { error } = await admin
      .from('snapshot_keywords')
      .update({ status: 'queued', last_error: null })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
  if (body.top_n !== undefined) patch.top_n = Math.max(10, Math.min(200, Number(body.top_n)));
  if (body.auto_interval_minutes !== undefined) {
    patch.auto_interval_minutes = body.auto_interval_minutes == null || body.auto_interval_minutes === ''
      ? null
      : Math.max(5, Number(body.auto_interval_minutes));
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '업데이트 필드 없음' }, { status: 400 });

  const { data, error } = await admin
    .from('snapshot_keywords')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: row } = await admin
    .from('snapshot_keywords')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await admin.from('snapshot_keywords').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
