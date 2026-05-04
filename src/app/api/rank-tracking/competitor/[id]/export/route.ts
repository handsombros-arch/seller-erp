import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient, createAdminClient } from '@/lib/supabase/server';

type ProductRow = {
  id: string;
  rank: number;
  name: string;
  released_at: string | null;
  review_score: number | null;
  review_count: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  ctr: number | null;
  ctr_change_pct: number | null;
  winner_price: number | null;
  price_min: number | null;
  price_max: number | null;
  is_my_product: boolean;
};

type KeywordRow = {
  product_id: string;
  keyword: string;
  contributing_count: number | null;
  search_volume: number | null;
  search_volume_change_pct: number | null;
  exposure: number | null;
  exposure_change_pct: number | null;
  clicks: number | null;
  clicks_change_pct: number | null;
  avg_price: number | null;
  price_min: number | null;
  price_max: number | null;
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  // 공용 — user_id 필터 제거
  const admin = await createAdminClient();
  const { data: snapshot } = await admin
    .from('competitor_snapshots')
    .select('*')
    .eq('id', id)
    .single();
  if (!snapshot) return NextResponse.json({ error: '스냅샷 없음' }, { status: 404 });

  const { data: products } = await admin
    .from('competitor_snapshot_products')
    .select('*')
    .eq('snapshot_id', id)
    .order('rank', { ascending: true });

  const productIds = (products || []).map((p: ProductRow) => p.id);
  let keywords: KeywordRow[] = [];
  if (productIds.length) {
    const { data: kws } = await admin
      .from('competitor_snapshot_keywords')
      .select('*')
      .in('product_id', productIds);
    keywords = (kws || []) as KeywordRow[];
  }
  const productById = new Map<string, ProductRow>();
  for (const p of products || []) productById.set(p.id, p as ProductRow);

  // 시트 1: 경쟁상품
  const productsSheet = (products || []).map((p: ProductRow) => ({
    순위: p.rank,
    내상품: p.is_my_product ? 'O' : '',
    상품명: p.name,
    출시일: p.released_at,
    상품평점: p.review_score,
    리뷰수: p.review_count,
    검색어노출: p.exposure,
    '검색어노출 변화율(%)': p.exposure_change_pct,
    클릭: p.clicks,
    '클릭 변화율(%)': p.clicks_change_pct,
    '클릭율(%)': p.ctr,
    '클릭율 변화율(%)': p.ctr_change_pct,
    아이템위너가격: p.winner_price,
    최저가: p.price_min,
    최고가: p.price_max,
  }));

  // 시트 2: 키워드
  const keywordsSheet = keywords.map((k: KeywordRow) => {
    const p = productById.get(k.product_id);
    return {
      상품순위: p?.rank ?? null,
      상품명: p?.name ?? null,
      키워드: k.keyword,
      기여키워드수: k.contributing_count,
      검색량: k.search_volume,
      '검색량 변화율(%)': k.search_volume_change_pct,
      검색어노출: k.exposure,
      '검색어노출 변화율(%)': k.exposure_change_pct,
      클릭: k.clicks,
      '클릭 변화율(%)': k.clicks_change_pct,
      평균가격: k.avg_price,
      최저가: k.price_min,
      최고가: k.price_max,
    };
  });

  // 시트 3: 메타데이터
  const metaSheet = [
    { 항목: '스냅샷 ID', 값: snapshot.id },
    { 항목: '캡처 일시', 값: snapshot.captured_at },
    { 항목: '내 상품명', 값: snapshot.my_product_name ?? '' },
    { 항목: '내 상품 ID', 값: snapshot.my_product_id ?? '' },
    { 항목: '메모', 값: snapshot.memo ?? '' },
    { 항목: '경쟁상품 수', 값: products?.length ?? 0 },
    { 항목: '키워드 수', 값: keywords.length },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productsSheet), '경쟁상품');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(keywordsSheet), '키워드');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaSheet), '메타');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const ts = new Date(snapshot.captured_at).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `competitor-snapshot-${ts}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
