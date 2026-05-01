import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// 단일 스냅샷 상세 조회 (상품 + 키워드 포함)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: snapshot, error: snapErr } = await admin
    .from('competitor_snapshots')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (snapErr || !snapshot) {
    return NextResponse.json({ error: '스냅샷을 찾을 수 없습니다.' }, { status: 404 });
  }

  const { data: products, error: prodErr } = await admin
    .from('competitor_snapshot_products')
    .select('*')
    .eq('snapshot_id', id)
    .order('rank', { ascending: true });
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  const productIds = (products || []).map((p) => p.id);
  let keywordsByProduct: Record<string, unknown[]> = {};
  if (productIds.length) {
    const { data: keywords } = await admin
      .from('competitor_snapshot_keywords')
      .select('*')
      .in('product_id', productIds)
      .order('rank', { ascending: true, nullsFirst: false });
    for (const k of keywords || []) {
      (keywordsByProduct[k.product_id] ??= []).push(k);
    }
  }

  return NextResponse.json({
    snapshot,
    products: (products || []).map((p) => ({ ...p, keywords: keywordsByProduct[p.id] ?? [] })),
  });
}

// 스냅샷 삭제
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { error } = await admin
    .from('competitor_snapshots')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
