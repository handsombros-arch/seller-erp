import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(20, Number(searchParams.get('limit') || '8')));

  const admin = await createAdminClient();
  const { data: kw } = await admin
    .from('snapshot_keywords')
    .select('id, user_id, keyword, top_n')
    .eq('id', id)
    .maybeSingle();
  if (!kw || kw.user_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: snaps } = await admin
    .from('keyword_snapshots')
    .select('id, checked_at, top_n, items_count')
    .eq('keyword_id', id)
    .order('checked_at', { ascending: false })
    .limit(limit);

  const snapIds = (snaps || []).map((s) => s.id);
  let items: Array<{ snapshot_id: string; rank: number; product_id: string | null; title: string | null; price: string | null; is_ad: boolean; is_rocket: boolean; thumbnail_url: string | null }> = [];
  if (snapIds.length) {
    const { data } = await admin
      .from('keyword_snapshot_items')
      .select('snapshot_id, rank, product_id, title, price, is_ad, is_rocket, thumbnail_url')
      .in('snapshot_id', snapIds)
      .order('rank', { ascending: true });
    items = data || [];
  }

  const snapshotList = (snaps || []).reverse().map((s) => ({ id: s.id, checked_at: s.checked_at, items_count: s.items_count }));
  const snapIndex: Record<string, number> = {};
  snapshotList.forEach((s, i) => { snapIndex[s.id] = i; });

  const top_n = kw.top_n;
  const rows: Array<{ rank: number; cells: (typeof items[number] | null)[] }> = [];
  for (let r = 1; r <= top_n; r++) {
    rows.push({ rank: r, cells: new Array(snapshotList.length).fill(null) });
  }
  for (const it of items) {
    const col = snapIndex[it.snapshot_id];
    const rowIdx = it.rank - 1;
    if (col === undefined || rowIdx < 0 || rowIdx >= rows.length) continue;
    rows[rowIdx].cells[col] = it;
  }

  // 상품별 순위 변동 트레이스: pid → {snapIdx: rank, snapIdx: rank ...}
  const pidTrace: Record<string, { title: string | null; ranksBySnap: (number | null)[]; firstSeenCol: number }> = {};
  for (const it of items) {
    if (!it.product_id) continue;
    const col = snapIndex[it.snapshot_id];
    if (col === undefined) continue;
    if (!pidTrace[it.product_id]) {
      pidTrace[it.product_id] = {
        title: it.title,
        ranksBySnap: new Array(snapshotList.length).fill(null),
        firstSeenCol: col,
      };
    }
    pidTrace[it.product_id].ranksBySnap[col] = it.rank;
    if (it.title && !pidTrace[it.product_id].title) pidTrace[it.product_id].title = it.title;
  }
  const traces = Object.entries(pidTrace).map(([pid, t]) => ({
    product_id: pid,
    title: t.title,
    ranksBySnap: t.ranksBySnap,
    bestRank: Math.min(...t.ranksBySnap.filter((v): v is number => v != null)),
  })).sort((a, b) => a.bestRank - b.bestRank);

  return NextResponse.json({
    keyword: kw,
    snapshots: snapshotList,
    rows,
    traces,
  });
}
