import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { parseCompetitorSnapshot } from '@/lib/coupang/parse-competitor-snapshot';

// 스냅샷 목록 조회
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: snapshots, error } = await admin
    .from('competitor_snapshots')
    .select('id, captured_at, my_product_name, my_product_id, memo, created_at, category_name, category_path, total_impression, top100_impression, top100_search_pct, top100_ad_pct, total_click')
    .eq('user_id', user.id)
    .order('captured_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 각 스냅샷의 상품/키워드 카운트 + 평균 판매가(상품 winner_price 평균) 집계
  const ids = (snapshots || []).map((s) => s.id);
  const aggBySnapshot: Record<string, { products: number; keywords: number; avg_winner_price: number | null }> = {};
  if (ids.length) {
    const { data: prodRows } = await admin
      .from('competitor_snapshot_products')
      .select('id, snapshot_id, winner_price')
      .in('snapshot_id', ids);
    const prodIdsBySnap: Record<string, string[]> = {};
    const winnerSumBySnap: Record<string, { sum: number; count: number }> = {};
    for (const row of prodRows || []) {
      (prodIdsBySnap[row.snapshot_id] ??= []).push(row.id);
      if (row.winner_price != null) {
        const wp = Number(row.winner_price);
        if (Number.isFinite(wp)) {
          (winnerSumBySnap[row.snapshot_id] ??= { sum: 0, count: 0 });
          winnerSumBySnap[row.snapshot_id].sum += wp;
          winnerSumBySnap[row.snapshot_id].count += 1;
        }
      }
    }
    const allProdIds = (prodRows || []).map((p) => p.id);
    let kwBy: Record<string, number> = {};
    if (allProdIds.length) {
      const { data: kwRows } = await admin
        .from('competitor_snapshot_keywords')
        .select('product_id')
        .in('product_id', allProdIds);
      for (const k of kwRows || []) {
        kwBy[k.product_id] = (kwBy[k.product_id] ?? 0) + 1;
      }
    }
    for (const sid of ids) {
      const pids = prodIdsBySnap[sid] || [];
      const w = winnerSumBySnap[sid];
      aggBySnapshot[sid] = {
        products: pids.length,
        keywords: pids.reduce((sum, pid) => sum + (kwBy[pid] ?? 0), 0),
        avg_winner_price: w && w.count > 0 ? Math.round(w.sum / w.count) : null,
      };
    }
  }

  const enriched = (snapshots || []).map((s) => ({
    ...s,
    products_count: aggBySnapshot[s.id]?.products ?? 0,
    keywords_count: aggBySnapshot[s.id]?.keywords ?? 0,
    avg_winner_price: aggBySnapshot[s.id]?.avg_winner_price ?? null,
  }));

  return NextResponse.json({ snapshots: enriched });
}

// 스냅샷 저장
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const rawText = String(body.raw_text || '');
  const myProductName = body.my_product_name ? String(body.my_product_name).trim() : null;
  const myProductId = body.my_product_id ? String(body.my_product_id).trim() : null;
  const memo = body.memo ? String(body.memo).trim() : null;

  if (!rawText.trim()) {
    return NextResponse.json({ error: 'raw_text 가 비어있습니다.' }, { status: 400 });
  }

  const parsed = parseCompetitorSnapshot(rawText);
  if (parsed.products.length === 0) {
    return NextResponse.json(
      { error: '파싱된 상품이 없습니다.', warnings: parsed.warnings },
      { status: 400 },
    );
  }

  const admin = await createAdminClient();

  const { data: snapshot, error: snapErr } = await admin
    .from('competitor_snapshots')
    .insert({
      user_id: user.id,
      my_product_name: myProductName,
      my_product_id: myProductId,
      memo,
      raw_text: rawText,
      category_name: parsed.category?.category_name ?? null,
      category_path: parsed.category?.category_path ?? null,
      total_impression: parsed.category?.total_impression ?? null,
      top100_impression: parsed.category?.top100_impression ?? null,
      top100_search_pct: parsed.category?.top100_search_pct ?? null,
      top100_ad_pct: parsed.category?.top100_ad_pct ?? null,
      total_click: parsed.category?.total_click ?? null,
    })
    .select()
    .single();

  if (snapErr || !snapshot) {
    return NextResponse.json({ error: snapErr?.message || '스냅샷 생성 실패' }, { status: 500 });
  }

  // 상품 일괄 insert (id 회수 위해 select)
  const productRows = parsed.products.map((p) => ({
    snapshot_id: snapshot.id,
    rank: p.rank,
    name: p.name,
    released_at: p.released_at,
    review_score: p.review_score,
    review_count: p.review_count,
    exposure: p.exposure,
    exposure_change_pct: p.exposure_change_pct,
    clicks: p.clicks,
    clicks_change_pct: p.clicks_change_pct,
    ctr: p.ctr,
    ctr_change_pct: p.ctr_change_pct,
    winner_price: p.winner_price,
    price_min: p.price_min,
    price_max: p.price_max,
    is_my_product: p.is_my_product,
  }));

  const { data: insertedProducts, error: prodErr } = await admin
    .from('competitor_snapshot_products')
    .insert(productRows)
    .select('id, rank');

  if (prodErr || !insertedProducts) {
    // 롤백: 스냅샷 삭제
    await admin.from('competitor_snapshots').delete().eq('id', snapshot.id);
    return NextResponse.json({ error: prodErr?.message || '상품 저장 실패' }, { status: 500 });
  }

  const productIdByRank = new Map<number, string>();
  for (const ip of insertedProducts) productIdByRank.set(ip.rank, ip.id);

  const keywordRows = parsed.products.flatMap((p) => {
    const pid = productIdByRank.get(p.rank);
    if (!pid) return [];
    return p.keywords.map((k) => ({
      product_id: pid,
      rank: k.rank,
      keyword: k.keyword,
      contributing_count: k.contributing_count,
      search_volume: k.search_volume,
      search_volume_change_pct: k.search_volume_change_pct,
      exposure: k.exposure,
      exposure_change_pct: k.exposure_change_pct,
      clicks: k.clicks,
      clicks_change_pct: k.clicks_change_pct,
      avg_price: k.avg_price,
      price_min: k.price_min,
      price_max: k.price_max,
    }));
  });

  if (keywordRows.length) {
    const { error: kwErr } = await admin
      .from('competitor_snapshot_keywords')
      .insert(keywordRows);
    if (kwErr) {
      // 키워드 실패해도 상품/스냅샷은 살림. 경고만.
      return NextResponse.json({
        snapshot_id: snapshot.id,
        products: parsed.products.length,
        keywords_saved: 0,
        warnings: [`키워드 저장 일부 실패: ${kwErr.message}`, ...parsed.warnings],
      });
    }
  }

  return NextResponse.json({
    snapshot_id: snapshot.id,
    products: parsed.products.length,
    keywords_saved: keywordRows.length,
    warnings: parsed.warnings,
  });
}
