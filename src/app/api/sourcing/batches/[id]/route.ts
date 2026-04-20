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

  // batch_items ↔ analyses JOIN (재사용 포함 전체 연결)
  const { data: links, error } = await admin
    .from('sourcing_batch_items')
    .select('batch_rank, analysis:sourcing_analyses(id, url, platform, product_id, status, error, product_info, review_stats, reviews_count, inquiries_count, analyzed_at, updated_at, created_at)')
    .eq('batch_id', id)
    .order('batch_rank', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (links ?? [])
    .map((l: { batch_rank: number | null; analysis: Record<string, unknown> | null }) => (
      l.analysis ? { ...l.analysis, batch_rank: l.batch_rank } : null
    ))
    .filter(Boolean);

  return NextResponse.json({ batch, items });
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

  // batch_items 는 CASCADE. sourcing_analyses 는 공유 자원이라 유지 (다른 배치에도 있을 수 있음)
  // 다만 batch_id 가 이 배치인 analysis 는 마지막 참조였을 가능성 있으므로 batch_id 만 null
  await admin.from('sourcing_analyses').update({ batch_id: null, batch_rank: null }).eq('batch_id', id);
  const { error } = await admin.from('sourcing_batches').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
