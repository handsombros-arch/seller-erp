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
  vendorId?: string | null;
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
    empty_qty: Number((p as any).emptyQty) || 0,   // 빈박스(리뷰) 수량 — 원가 제외
    vendor_item_id: p.vendorId || null,              // 옵션ID (등록 필요 큐용, 00064)
    match_method: p.method,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    let { error } = await admin.from('monthly_product_sales').insert(rows);
    if (error && /vendor_item_id|schema cache/i.test(error.message)) {
      ({ error } = await admin.from('monthly_product_sales').insert(rows.map(({ vendor_item_id: _v, ...r }: any) => r)));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 빈박스(리뷰) 수량 → 재고 되돌리기 (이 달·플랫폼 전체를 다시 계산, 멱등)
  try {
    const restored = await restoreEmptyBoxes(admin, user.id, body.yearMonth, body.platform);
    return NextResponse.json({ ok: true, saved: rows.length, restored });
  } catch (e: any) {
    return NextResponse.json({ ok: true, saved: rows.length, restoreError: e?.message ?? String(e) });
  }
}

/**
 * 빈박스 재고 되돌리기. 주문 동기화가 이미 차감했지만 실제로 나가지 않은 수량을 재고에 더한다.
 * 같은 (월, 플랫폼) 의 이전 되돌림을 먼저 취소하고, 현재 저장된 empty_qty 로 다시 적용한다 (멱등).
 */
async function restoreEmptyBoxes(admin: any, userId: string, yearMonth: string, platform: string): Promise<number> {
  const EMPTY_PREFIX = `emptybox:${yearMonth}:${platform}:`;
  let restored = 0;
  const { data: prev } = await admin.from('inventory_adjustments').select('id, sku_id, warehouse_id, reason').like('reason', `${EMPTY_PREFIX}%`);
  for (const a of prev ?? []) {
    const m = /:\+(\d+)$/.exec(String(a.reason)); const q = m ? Number(m[1]) : 0;
    if (q > 0) {
      const { data: inv } = await admin.from('inventory').select('quantity').eq('sku_id', a.sku_id).eq('warehouse_id', a.warehouse_id).maybeSingle();
      const before = Number(inv?.quantity ?? 0);
      await admin.from('inventory').update({ quantity: before - q, updated_at: new Date().toISOString() }).eq('sku_id', a.sku_id).eq('warehouse_id', a.warehouse_id);
    }
    await admin.from('inventory_adjustments').delete().eq('id', a.id);
  }
  const { data: rows } = await admin.from('monthly_product_sales').select('sku_id, empty_qty').eq('user_id', userId).eq('year_month', yearMonth).eq('platform', platform).gt('empty_qty', 0);
  for (const r of rows ?? []) {
    const q = Number(r.empty_qty) || 0;
    if (q <= 0 || !r.sku_id) continue;
    const { data: invs } = await admin.from('inventory').select('warehouse_id, quantity').eq('sku_id', r.sku_id).order('quantity', { ascending: false }).limit(1);
    const inv = invs?.[0];
    if (!inv) continue;
    const before = Number(inv.quantity ?? 0);
    await admin.from('inventory').update({ quantity: before + q, updated_at: new Date().toISOString() }).eq('sku_id', r.sku_id).eq('warehouse_id', inv.warehouse_id);
    await admin.from('inventory_adjustments').insert({ sku_id: r.sku_id, warehouse_id: inv.warehouse_id, before_quantity: before, after_quantity: before + q, reason: `${EMPTY_PREFIX}${r.sku_id}:+${q}`, adjusted_by: userId });
    restored += q;
  }
  return restored;
}

/**
 * PATCH { id, empty_qty } — 이미 적용한 달의 한 행에 빈박스 수량만 넣는다.
 * 원가 = 단가 × (수량 − 빈박스) 로 다시 계산하고, 그 달·플랫폼의 재고 되돌리기를 다시 맞춘다.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? ''); const empty = Math.max(0, Math.round(Number(body.empty_qty) || 0));
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { data: row, error: rErr } = await admin.from('monthly_product_sales').select('id, year_month, platform, qty, unit_cost').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (rErr || !row) return NextResponse.json({ error: rErr?.message ?? '행을 찾을 수 없습니다' }, { status: 404 });
  const { data: closed } = await admin.from('settlement_months').select('year_month').eq('year_month', row.year_month).maybeSingle();
  if (closed) return NextResponse.json({ error: `${row.year_month} 은 마감된 달입니다. 해제 후 수정하세요.` }, { status: 409 });
  const qty = Number(row.qty) || 0;
  if (empty > qty) return NextResponse.json({ error: `빈박스 수량이 판매 수량(${qty})보다 큽니다` }, { status: 400 });
  const unit = Number(row.unit_cost) || 0;
  const { error } = await admin.from('monthly_product_sales').update({ empty_qty: empty, total_cost: unit * (qty - empty), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  try {
    const restored = await restoreEmptyBoxes(admin, user.id, row.year_month, row.platform);
    return NextResponse.json({ ok: true, restored });
  } catch (e: any) {
    return NextResponse.json({ ok: true, restoreError: e?.message ?? String(e) });
  }
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
    .select('*, sku:skus(id, sku_code, cost_price, option_values, product:products(id, name, logistics_tier))')
    .eq('user_id', user.id);
  if (yearMonth) q = q.eq('year_month', yearMonth);
  if (platform) q = q.eq('platform', platform);

  const { data, error } = await q.order('revenue', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // B2B 직거래 출고 내역(b2b_lines) → platform 'b2b' 매출 행으로 합성 (상품별 순이익·월별 추이용).
  // 매출 = 수량 × 공급단가 × 1.1 (다른 마켓 행과 같은 VAT 포함 실거래 기준), 원가 = 수량 × 선택 당시 원가.
  const rows: any[] = data ?? [];
  if (!platform || platform === 'b2b') {
    let bq = admin.from('b2b_lines').select('id, year_month, sku_id, display_name, qty, unit_cost, unit_price, price_incl_vat, sku:skus(id, sku_code, cost_price, product:products(id, name, logistics_tier))').eq('user_id', user.id);
    if (yearMonth) bq = bq.eq('year_month', yearMonth);
    const { data: b2b } = await bq;   // 테이블 미적용이면 무시
    for (const l of (b2b ?? []) as any[]) {
      const qty = Number(l.qty) || 0;
      rows.push({
        id: `b2b:${l.id}`, year_month: l.year_month, platform: 'b2b', sku_id: l.sku_id, display_name: l.display_name,
        qty, revenue: Math.round(qty * (l.price_incl_vat ? (Number(l.unit_price) || 0) : (Number(l.unit_price) || 0) * 1.1)), unit_cost: Number(l.unit_cost) || 0, total_cost: qty * (Number(l.unit_cost) || 0),   // 매출은 합계금액(VAT 포함) 기준
        empty_qty: 0, match_method: 'b2b', user_id: user.id, sku: l.sku,
      });
    }
  }
  return NextResponse.json(rows);
}
