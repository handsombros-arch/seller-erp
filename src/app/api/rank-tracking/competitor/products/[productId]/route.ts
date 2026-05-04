import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// 경쟁상품의 일부 필드 수동 수정 (현재는 winner_price만).
// 소유권: 상품 → 스냅샷 → user_id 로 검증.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ productId: string }> },
) {
  const { productId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const winnerPrice =
    body.winner_price === null || body.winner_price === undefined
      ? null
      : Number(body.winner_price);
  if (winnerPrice !== null && !Number.isFinite(winnerPrice)) {
    return NextResponse.json({ error: 'winner_price 형식 오류' }, { status: 400 });
  }

  const admin = await createAdminClient();
  // 상품 존재만 확인 — competitor_snapshots 는 팀 공용 데이터라 user_id 검증 안 함
  const { data: product } = await admin
    .from('competitor_snapshot_products')
    .select('id, snapshot_id')
    .eq('id', productId)
    .single();
  if (!product) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

  const { error } = await admin
    .from('competitor_snapshot_products')
    .update({ winner_price: winnerPrice })
    .eq('id', productId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, winner_price: winnerPrice });
}
