import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: batch } = await admin
    .from('sourcing_batches')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!batch || batch.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: items, error } = await admin
    .from('sourcing_analyses')
    .select('id, url, platform, product_id, status, error, product_info, review_stats, reviews_count, inquiries_count, batch_rank, analyzed_at, updated_at, created_at')
    .eq('batch_id', id)
    .order('batch_rank', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ batch, items: items || [] });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: batch } = await admin
    .from('sourcing_batches')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!batch || batch.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 자식 분석들도 같이 삭제
  await admin.from('sourcing_analyses').delete().eq('batch_id', id);
  const { error } = await admin.from('sourcing_batches').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
