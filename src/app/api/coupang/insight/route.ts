import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { loadExtraVidMap } from '@/lib/settlement/extraIds';

const isMissing = (m: string) => /does not exist|schema cache|PGRST205/i.test(m);
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; };

/**
 * 쿠팡 윙 비즈니스 인사이트 상품별 판매 리포트 (기간 × 옵션ID)
 * GET  ?periods=1                       → 저장된 기간 목록 [{ period_from, period_to, rows, qty, revenue, updated_at }]
 * GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD   → 그 기간 행 (SKU·상품 조인)
 * POST { period_from, period_to, rows: [{ '옵션 ID', '옵션명', ... }], source? } → 기간 통째로 교체 저장 (옵션ID → SKU 매칭)
 * DELETE ?from&to                       → 기간 삭제
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  const sp = request.nextUrl.searchParams;
  if (sp.get('periods') === '1') {
    const { data, error } = await admin.from('coupang_insight_metrics').select('period_from, period_to, qty, revenue, updated_at').eq('user_id', user.id);
    if (error) return NextResponse.json({ periods: [], needsMigration: isMissing(error.message), error: error.message });
    const m = new Map<string, { period_from: string; period_to: string; rows: number; qty: number; revenue: number; updated_at: string }>();
    for (const r of (data ?? []) as any[]) { const k = `${r.period_from}|${r.period_to}`; const a = m.get(k) ?? { period_from: r.period_from, period_to: r.period_to, rows: 0, qty: 0, revenue: 0, updated_at: r.updated_at }; a.rows += 1; a.qty += Number(r.qty) || 0; a.revenue += Number(r.revenue) || 0; if (r.updated_at > a.updated_at) a.updated_at = r.updated_at; m.set(k, a); }
    return NextResponse.json({ periods: [...m.values()].sort((a, b) => b.period_to.localeCompare(a.period_to) || b.period_from.localeCompare(a.period_from)) });
  }
  const from = sp.get('from'), to = sp.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to 필요' }, { status: 400 });
  const { data, error } = await admin.from('coupang_insight_metrics').select('*, sku:skus(id, sku_code, option_values, cost_price, product:products(id, name))').eq('user_id', user.id).eq('period_from', from).eq('period_to', to).order('revenue', { ascending: false });
  if (error) return NextResponse.json({ rows: [], needsMigration: isMissing(error.message), error: error.message });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const from = String(body.period_from ?? ''), to = String(body.period_to ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return NextResponse.json({ error: 'period_from ≤ period_to (YYYY-MM-DD) 필요' }, { status: 400 });
  if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ error: 'rows 필요' }, { status: 400 });
  const admin = await createAdminClient();
  // 옵션ID → SKU (기본 + 추가 옵션ID + RG 스냅샷)
  const [{ data: ps }, { data: rg }, extra] = await Promise.all([
    admin.from('platform_skus').select('platform_sku_id, sku_id, channel:channels(type)'),
    admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id').not('sku_id', 'is', null),
    loadExtraVidMap(admin, 'coupang'),
  ]);
  const vid2sku = new Map<string, string>();
  for (const p of (ps ?? []) as any[]) if (p.platform_sku_id && (p.channel?.type ?? 'coupang') === 'coupang') vid2sku.set(String(p.platform_sku_id), p.sku_id);
  for (const [v, s] of extra) if (!vid2sku.has(v)) vid2sku.set(v, s);
  for (const r of (rg ?? []) as any[]) if (!vid2sku.has(String(r.vendor_item_id))) vid2sku.set(String(r.vendor_item_id), r.sku_id);

  const pct = (v: unknown) => { const n = num(v); return isFinite(n) ? n : null; };
  // 같은 기간을 다시 올려도 손으로 적은 빈박스 수량은 유지 (말없는 삭제 금지)
  const { data: prevRows } = await admin.from('coupang_insight_metrics').select('vendor_item_id, empty_qty').eq('user_id', user.id).eq('period_from', from).eq('period_to', to);
  const prevEmpty = new Map<string, number>((prevRows ?? []).map((r: any) => [String(r.vendor_item_id), Number(r.empty_qty) || 0]));
  const payload = (body.rows as Record<string, unknown>[]).map(r => {
    const vid = String(r['옵션 ID'] ?? r['옵션ID'] ?? '').replace(/\.0$/, '').trim();
    return {
      user_id: user.id, period_from: from, period_to: to, vendor_item_id: vid, empty_qty: prevEmpty.get(vid) ?? 0,
      option_name: String(r['옵션명'] ?? '') || null, product_name: String(r['상품명'] ?? '') || null, product_id: String(r['등록상품ID'] ?? '').replace(/\.0$/, '') || null,
      category: String(r['카테고리'] ?? '') || null, sales_method: String(r['판매방식'] ?? '') || null,
      revenue: num(r['매출(원)']), orders: Math.round(num(r['주문'])), qty: Math.round(num(r['판매량'])), visitors: Math.round(num(r['방문자'])), views: Math.round(num(r['조회'])), carts: Math.round(num(r['장바구니'])),
      conv_rate: pct(r['구매전환율']), winner_rate: pct(r['아이템위너 비율(%)']),
      gross_revenue: num(r['총 매출(원)']), gross_qty: Math.round(num(r['총 판매수'])), cancel_amount: num(r['총 취소 금액(원)']), cancel_qty: Math.round(num(r['총 취소된 상품수'])), instant_cancel_qty: Math.round(num(r['즉시 취소된 상품수'])),
      sku_id: vid2sku.get(vid) ?? null, source: body.source ? String(body.source) : 'upload', updated_at: new Date().toISOString(),
    };
  }).filter(r => r.vendor_item_id);
  if (!payload.length) return NextResponse.json({ error: "'옵션 ID' 컬럼이 없거나 비어 있습니다. 비즈니스 인사이트 > 엑셀 다운로드 > 상품별 판매 리포트 파일인지 확인하세요." }, { status: 400 });
  // 기간 통째로 교체 (같은 기간 재업로드 = 최신본)
  const del = await admin.from('coupang_insight_metrics').delete().eq('user_id', user.id).eq('period_from', from).eq('period_to', to);
  if (del.error) return NextResponse.json({ error: isMissing(del.error.message) ? '마이그레이션 00072(coupang_insight_metrics) 를 적용해 주세요' : del.error.message, needsMigration: isMissing(del.error.message) }, { status: 400 });
  for (let i = 0; i < payload.length; i += 500) {
    let { error } = await admin.from('coupang_insight_metrics').upsert(payload.slice(i, i + 500), { onConflict: 'user_id,period_from,period_to,vendor_item_id' });
    if (error && /empty_qty/.test(error.message)) {   // 00073 미적용 DB: 빈박스 컬럼 없이 저장
      ({ error } = await admin.from('coupang_insight_metrics').upsert(payload.slice(i, i + 500).map(({ empty_qty: _e, ...r }) => r), { onConflict: 'user_id,period_from,period_to,vendor_item_id' }));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const matched = payload.filter(p => p.sku_id).length;
  // 마스터 판매가(정가 = 쿠폰 적용 전) 자동 갱신 — 리포트의 총 매출 ÷ 총 판매수가 옵션의 판매가. 가장 최근 기간을 올렸을 때만(옛 리포트로 되돌리지 않음)
  const priceSync = await syncMasterPrices(admin, user.id, to, payload.map(p => ({ vid: p.vendor_item_id, unit: p.gross_qty > 0 ? p.gross_revenue / p.gross_qty : 0 })));
  return NextResponse.json({ ok: true, saved: payload.length, matched, unmatched: payload.length - matched, qty: payload.reduce((s, p) => s + p.qty, 0), revenue: payload.reduce((s, p) => s + p.revenue, 0), ...priceSync });
}

/** 인사이트 판매가 → platform_skus.price(기본 옵션ID) · platform_sku_ids.price(추가 옵션ID). 정수 단가만, 값이 다를 때만. */
async function syncMasterPrices(admin: Awaited<ReturnType<typeof createAdminClient>>, userId: string, periodTo: string, units: { vid: string; unit: number }[]): Promise<{ priceUpdated: number; priceSkipped?: string }> {
  try {
    const { data: latest } = await admin.from('coupang_insight_metrics').select('period_to').eq('user_id', userId).order('period_to', { ascending: false }).limit(1).maybeSingle();
    if (latest?.period_to && String(latest.period_to) > periodTo) return { priceUpdated: 0, priceSkipped: `최근 기간(${latest.period_to})보다 앞선 리포트라 판매가는 갱신하지 않음` };
    const want = new Map<string, number>();
    for (const u of units) if (u.vid && u.unit > 0 && Number.isInteger(u.unit)) want.set(u.vid, u.unit);
    if (!want.size) return { priceUpdated: 0 };
    const vids = [...want.keys()];
    const [{ data: ps }, { data: ex }] = await Promise.all([
      admin.from('platform_skus').select('id, platform_sku_id, price, channel:channels(type)').in('platform_sku_id', vids),
      admin.from('platform_sku_ids').select('id, platform_sku_id, price, channel:channels(type)').in('platform_sku_id', vids),
    ]);
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((ps ?? []) as any[])) { if ((p.channel?.type ?? 'coupang') !== 'coupang') continue; const w = want.get(String(p.platform_sku_id)); if (w == null || Number(p.price) === w) continue; const { error } = await admin.from('platform_skus').update({ price: w, updated_at: new Date().toISOString() }).eq('id', p.id); if (!error) n++; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((ex ?? []) as any[])) { if ((p.channel?.type ?? 'coupang') !== 'coupang') continue; const w = want.get(String(p.platform_sku_id)); if (w == null || Number(p.price) === w) continue; const { error } = await admin.from('platform_sku_ids').update({ price: w }).eq('id', p.id); if (!error) n++; }
    return { priceUpdated: n };
  } catch { return { priceUpdated: 0 }; }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const from = request.nextUrl.searchParams.get('from'), to = request.nextUrl.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { error } = await admin.from('coupang_insight_metrics').delete().eq('user_id', user.id).eq('period_from', from).eq('period_to', to);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** PATCH { id, empty_qty } — 기간 행의 빈박스(리뷰용) 수량. 순판매 = 총 판매수 − 취소 − 빈박스 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? ''); const empty = Math.max(0, Math.round(Number(b.empty_qty) || 0));
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { error } = await admin.from('coupang_insight_metrics').update({ empty_qty: empty, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: isMissing(error.message) || /empty_qty/.test(error.message) ? '마이그레이션 00073(empty_qty) 을 적용해 주세요' : error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
