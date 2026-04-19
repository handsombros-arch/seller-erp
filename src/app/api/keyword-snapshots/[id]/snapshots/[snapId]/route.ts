import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; snapId: string }> }) {
  const { id, snapId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: snap } = await admin
    .from('keyword_snapshots')
    .select('id, keyword_id, user_id, keyword, checked_at, top_n, items_count')
    .eq('id', snapId)
    .eq('keyword_id', id)
    .maybeSingle();
  if (!snap || snap.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: items, error } = await admin
    .from('keyword_snapshot_items')
    .select('rank, product_id, title, price, is_ad, is_rocket, thumbnail_url, product_url, rating, review_count')
    .eq('snapshot_id', snapId)
    .order('rank', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ snapshot: snap, items: items || [] });
}
