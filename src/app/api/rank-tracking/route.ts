import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { data: keywords, error } = await admin
    .from('rank_keywords')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (keywords || []).map((k) => k.id);
  let historyByKeyword: Record<string, Array<{ checked_date: string; rank: number | null; is_ad: boolean | null; page: number | null }>> = {};
  if (ids.length) {
    const { data: hist } = await admin
      .from('rank_history')
      .select('keyword_id, checked_date, checked_at, rank, is_ad, page')
      .in('keyword_id', ids)
      .order('checked_at', { ascending: false })
      .limit(2000);
    for (const h of hist || []) {
      if (!historyByKeyword[h.keyword_id]) historyByKeyword[h.keyword_id] = [];
      historyByKeyword[h.keyword_id].push({
        checked_date: h.checked_date,
        rank: h.rank,
        is_ad: h.is_ad,
        page: h.page,
      });
    }
  }

  return NextResponse.json({ keywords: keywords || [], historyByKeyword });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const keyword = String(body.keyword || '').trim();
  const productId = String(body.product_id || '').trim();
  const productName = body.product_name ? String(body.product_name).trim() : null;
  const targetRank = body.target_rank ? Number(body.target_rank) : null;
  const maxPages = body.max_pages ? Math.max(1, Math.min(20, Number(body.max_pages))) : 5;

  if (!keyword || !productId) {
    return NextResponse.json({ error: 'keyword, product_id 필수' }, { status: 400 });
  }
  if (!/^\d+$/.test(productId)) {
    return NextResponse.json({ error: 'product_id 는 숫자 (쿠팡 상품 ID)' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('rank_keywords')
    .insert({
      user_id: user.id,
      platform: 'coupang',
      keyword,
      product_id: productId,
      product_name: productName,
      target_rank: targetRank,
      max_pages: maxPages,
      status: 'queued',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '이미 등록된 키워드+상품 조합입니다.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
