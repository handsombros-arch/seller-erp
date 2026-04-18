import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { id } = await ctx.params;

  const admin = await createAdminClient();
  const { data, error } = await admin.from('sourcing_analyses').select('*').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { id } = await ctx.params;

  const admin = await createAdminClient();
  const { error } = await admin.from('sourcing_analyses').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // retry: status를 pending으로 리셋
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const admin = await createAdminClient();
  const update: Record<string, unknown> = {};
  if (body.action === 'retry') {
    update.status = 'pending';
    update.error = null;
  }
  if (body.note !== undefined) update.note = body.note;

  const { data, error } = await admin.from('sourcing_analyses').update(update).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
