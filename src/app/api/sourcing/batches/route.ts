import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: batches, error } = await admin
    .from('sourcing_batches')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (batches || []).map((b) => b.id);
  // 각 배치별 자식 상태 집계
  let statsByBatch: Record<string, { total: number; done: number; failed: number; pending: number; crawling: number; analyzing: number }> = {};
  if (ids.length) {
    const { data: children } = await admin
      .from('sourcing_analyses')
      .select('batch_id, status')
      .in('batch_id', ids);
    for (const c of children || []) {
      const bid = c.batch_id as string;
      if (!statsByBatch[bid]) statsByBatch[bid] = { total: 0, done: 0, failed: 0, pending: 0, crawling: 0, analyzing: 0 };
      statsByBatch[bid].total++;
      const s = c.status as keyof typeof statsByBatch[string];
      if (s in statsByBatch[bid]) statsByBatch[bid][s]++;
    }
  }

  return NextResponse.json({ batches: batches || [], statsByBatch });
}
