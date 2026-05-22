import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

interface SalesRow {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  unitCost: number;
  matched: boolean;
  method: string;
  skuId: string | null;
}

// ──────────────────────────────────────────────────────────
// PUT: calc-cost 결과를 monthly_product_sales 에 upsert
// ──────────────────────────────────────────────────────────
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json() as {
    yearMonth: string;
    platform: string;
    products: SalesRow[];
  };

  if (!body.yearMonth || !body.platform || !Array.isArray(body.products)) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // 같은 (user_id, year_month, platform) 의 이전 데이터 전부 삭제 후 재삽입
  // — calc-cost 재실행 시 displayName이 바뀔 수 있어 incremental upsert 보다 안전
  await admin.from('monthly_product_sales').delete()
    .eq('user_id', user.id)
    .eq('year_month', body.yearMonth)
    .eq('platform', body.platform);

  const rows = body.products.map(p => ({
    user_id: user.id,
    year_month: body.yearMonth,
    platform: body.platform,
    sku_id: p.skuId,
    display_name: p.name,
    qty: p.qty,
    revenue: p.revenue,
    unit_cost: p.unitCost,
    total_cost: p.cost,
    match_method: p.method,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await admin.from('monthly_product_sales').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}

// ──────────────────────────────────────────────────────────
// GET: 저장된 월별 매출 조회
// ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('year_month');
  const platform = searchParams.get('platform');

  const admin = await createAdminClient();
  let q = admin.from('monthly_product_sales')
    .select('*, sku:skus(id, sku_code, cost_price, product:products(id, name, logistics_tier))')
    .eq('user_id', user.id);
  if (yearMonth) q = q.eq('year_month', yearMonth);
  if (platform) q = q.eq('platform', platform);

  const { data, error } = await q.order('revenue', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
