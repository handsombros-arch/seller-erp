import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  parseCompetitorSnapshot,
  parseMultipleSnapshots,
  type ParseResult,
} from '@/lib/coupang/parse-competitor-snapshot';
import type { SupabaseClient } from '@supabase/supabase-js';

// 스냅샷 목록 조회
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  // 공용(팀 전체)으로 보이게 — user_id 필터 제거.
  // limit 도 200 → 5000 으로 (오래된 페이스트가 잘려나가던 문제). 이후 수천을 넘으면 페이지네이션으로.
  const admin = await createAdminClient();
  const { data: snapshots, error } = await admin
    .from('competitor_snapshots')
    .select('id, captured_at, my_product_name, my_product_id, memo, created_at, category_name, category_path, total_impression, top100_impression, top100_search_pct, top100_ad_pct, total_click')
    .order('captured_at', { ascending: false })
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 각 스냅샷의 상품/키워드 카운트 + 평균 판매가 집계.
  // 상품별 가격 우선순위: winner_price → (price_min + price_max) / 2 → price_min || price_max.
  // 셋 다 없는 경우만 카운트에서 제외.
  const ids = (snapshots || []).map((s) => s.id);
  const aggBySnapshot: Record<string, { products: number; keywords: number; avg_winner_price: number | null }> = {};

  // Supabase 기본 max-rows(1000) 우회용 페이지네이션 헬퍼.
  // .in() 결과도 1000행 캡되므로 직접 range 로 끊어 받아야 함.
  // 5000개 chunk 안전장치: 무한루프 방지 + 1행/요청 절대 0 으로 끊기.
  async function fetchAll<T>(
    fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> {
    const all: T[] = [];
    const PAGE = 1000;
    let from = 0;
    for (let guard = 0; guard < 5000; guard++) {
      const { data, error } = await fetchPage(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  if (ids.length) {
    type ProdRow = { id: string; snapshot_id: string; winner_price: number | null; price_min: number | null; price_max: number | null };
    // snapshot_id IN (ids) 자체는 OK 지만 응답 행 수가 1000+ 일 수 있음 → range 로 끊어 받기
    const prodRows = await fetchAll<ProdRow>(async (from, to) => {
      const r = await admin
        .from('competitor_snapshot_products')
        .select('id, snapshot_id, winner_price, price_min, price_max')
        .in('snapshot_id', ids)
        .order('id', { ascending: true })
        .range(from, to);
      return { data: r.data as ProdRow[] | null, error: r.error };
    });
    const prodIdsBySnap: Record<string, string[]> = {};
    const winnerSumBySnap: Record<string, { sum: number; count: number }> = {};
    const pickProductPrice = (row: { winner_price: unknown; price_min: unknown; price_max: unknown }): number | null => {
      const w = row.winner_price != null ? Number(row.winner_price) : NaN;
      if (Number.isFinite(w) && w > 0) return w;
      const lo = row.price_min != null ? Number(row.price_min) : NaN;
      const hi = row.price_max != null ? Number(row.price_max) : NaN;
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0) return (lo + hi) / 2;
      if (Number.isFinite(lo) && lo > 0) return lo;
      if (Number.isFinite(hi) && hi > 0) return hi;
      return null;
    };
    for (const row of prodRows) {
      (prodIdsBySnap[row.snapshot_id] ??= []).push(row.id);
      const price = pickProductPrice(row);
      if (price != null) {
        (winnerSumBySnap[row.snapshot_id] ??= { sum: 0, count: 0 });
        winnerSumBySnap[row.snapshot_id].sum += price;
        winnerSumBySnap[row.snapshot_id].count += 1;
      }
    }
    const allProdIds = prodRows.map((p) => p.id);
    let kwBy: Record<string, number> = {};
    // 키워드도 product_id IN (...) 결과가 1000+ 가능 → 페이지네이션 + product_id IN 자체도 chunk
    if (allProdIds.length) {
      // .in() 의 IN list 길이는 32k 정도까지 안전하지만, URL 길이 한계가 있어 product 1000개씩 chunk.
      const ID_CHUNK = 1000;
      type KwRow = { product_id: string };
      for (let i = 0; i < allProdIds.length; i += ID_CHUNK) {
        const idChunk = allProdIds.slice(i, i + ID_CHUNK);
        const kwRows = await fetchAll<KwRow>(async (from, to) => {
          const r = await admin
            .from('competitor_snapshot_keywords')
            .select('product_id')
            .in('product_id', idChunk)
            .order('product_id', { ascending: true })
            .range(from, to);
          return { data: r.data as KwRow[] | null, error: r.error };
        });
        for (const k of kwRows) {
          kwBy[k.product_id] = (kwBy[k.product_id] ?? 0) + 1;
        }
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

// 단일 스냅샷 insert. 성공 시 { snapshot_id, products, keywords_saved }, 실패 시 throw.
async function insertOneSnapshot(
  admin: SupabaseClient,
  parsed: ParseResult,
  meta: { user_id: string; my_product_name: string | null; my_product_id: string | null; memo: string | null; raw_text: string },
): Promise<{ snapshot_id: string; products: number; keywords_saved: number; warnings: string[] }> {
  const { data: snapshot, error: snapErr } = await admin
    .from('competitor_snapshots')
    .insert({
      user_id: meta.user_id,
      my_product_name: meta.my_product_name,
      my_product_id: meta.my_product_id,
      memo: meta.memo,
      raw_text: meta.raw_text,
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
  if (snapErr || !snapshot) throw new Error(snapErr?.message || '스냅샷 생성 실패');

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
    await admin.from('competitor_snapshots').delete().eq('id', snapshot.id);
    throw new Error(prodErr?.message || '상품 저장 실패');
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

  let keywordsSaved = 0;
  const warnings = [...parsed.warnings];
  if (keywordRows.length) {
    const { error: kwErr } = await admin
      .from('competitor_snapshot_keywords')
      .insert(keywordRows);
    if (kwErr) {
      warnings.unshift(`키워드 저장 일부 실패: ${kwErr.message}`);
    } else {
      keywordsSaved = keywordRows.length;
    }
  }

  return {
    snapshot_id: snapshot.id,
    products: parsed.products.length,
    keywords_saved: keywordsSaved,
    warnings,
  };
}

// 스냅샷 저장. body.batch === true 면 여러 카테고리 동시 paste 모드.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const rawText = String(body.raw_text || '');
  const myProductName = body.my_product_name ? String(body.my_product_name).trim() : null;
  const myProductId = body.my_product_id ? String(body.my_product_id).trim() : null;
  const memo = body.memo ? String(body.memo).trim() : null;
  const isBatch = body.batch === true;

  if (!rawText.trim()) {
    return NextResponse.json({ error: 'raw_text 가 비어있습니다.' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const baseMeta = { user_id: user.id, my_product_name: myProductName, my_product_id: myProductId, memo, raw_text: rawText };

  // ── Batch 모드: splitter → 각 chunk 별도 insert ─────────────────────────
  if (isBatch) {
    const { results, splitWarnings } = parseMultipleSnapshots(rawText);
    if (results.length === 0) {
      return NextResponse.json(
        { error: '파싱된 카테고리가 없습니다.', warnings: splitWarnings },
        { status: 400 },
      );
    }
    const saved: Array<{ snapshot_id: string; category_name: string | null; products: number; keywords_saved: number }> = [];
    const failed: Array<{ category_name: string | null; error: string }> = [];
    const allWarnings: string[] = [...splitWarnings];

    for (const r of results) {
      try {
        const ins = await insertOneSnapshot(admin, r, {
          ...baseMeta,
          // batch 의 각 chunk 는 자기 자신의 raw_text 만 보존
          raw_text: r.category ? `"${r.category.category_name}" 카테고리 결과\n${r.category.category_path.join('\n')}` : '',
        });
        saved.push({
          snapshot_id: ins.snapshot_id,
          category_name: r.category?.category_name ?? null,
          products: ins.products,
          keywords_saved: ins.keywords_saved,
        });
        if (ins.warnings.length) allWarnings.push(...ins.warnings);
      } catch (e: any) {
        failed.push({ category_name: r.category?.category_name ?? null, error: e?.message ?? String(e) });
      }
    }

    return NextResponse.json({ batch: true, saved, failed, warnings: allWarnings });
  }

  // ── 단일 paste 모드: 기존 동작 그대로 ────────────────────────────────────
  const parsed = parseCompetitorSnapshot(rawText);
  if (parsed.products.length === 0) {
    return NextResponse.json(
      { error: '파싱된 상품이 없습니다.', warnings: parsed.warnings },
      { status: 400 },
    );
  }

  try {
    const ins = await insertOneSnapshot(admin, parsed, baseMeta);
    return NextResponse.json(ins);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
