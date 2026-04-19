import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const action = body.action as string | undefined;
  const admin = await createAdminClient();

  const { data: row, error: fetchErr } = await admin
    .from('rank_keywords')
    .select('id, user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (action === 'queue') {
    const { error } = await admin
      .from('rank_keywords')
      .update({ status: 'queued', last_error: null })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
  if (body.target_rank !== undefined) patch.target_rank = body.target_rank ? Number(body.target_rank) : null;
  if (body.max_pages !== undefined) patch.max_pages = Math.max(1, Math.min(20, Number(body.max_pages)));
  if (body.product_name !== undefined) patch.product_name = body.product_name || null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '업데이트할 필드 없음' }, { status: 400 });

  const { data, error } = await admin
    .from('rank_keywords')
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
    .from('rank_keywords')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await admin.from('rank_keywords').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
