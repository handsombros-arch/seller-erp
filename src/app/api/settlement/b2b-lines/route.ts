import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * B2B 직거래 출고 내역 (SKU × 수량 × 공급단가 × 원가).
 * GET  ?year_month=YYYY-MM → { lines, needsMigration? }
 * PUT  { year_month, lines: [{ id?, sku_id, display_name, qty, unit_cost, unit_price, note }] }
 *      → 그 달의 내역을 이 목록으로 맞춘다 (목록에 없는 기존 줄은 삭제 — 화면에서 사용자가 지운 줄).
 *      마감된 달은 거부. 재고는 건드리지 않는다.
 */
const B2B_SELECT = 'id, year_month, sku_id, display_name, qty, unit_cost, unit_price, price_incl_vat, note, sort_order, sku:skus(id, sku_code, cost_price, product:products(id, name, logistics_tier))';

const isMissing = (msg: string) => /does not exist|schema cache|PGRST205/i.test(msg);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const ym = request.nextUrl.searchParams.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { data, error } = await admin.from('b2b_lines').select(B2B_SELECT).eq('user_id', user.id).eq('year_month', ym).order('sort_order').order('created_at');
  if (error) return NextResponse.json({ lines: [], needsMigration: isMissing(error.message), error: error.message });
  return NextResponse.json({ lines: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ym = String(body.year_month ?? '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month 필요' }, { status: 400 });
  if (!Array.isArray(body.lines)) return NextResponse.json({ error: 'lines 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const { data: closed } = await admin.from('settlement_months').select('year_month').eq('year_month', ym).maybeSingle();
  if (closed) return NextResponse.json({ error: `${ym} 은 마감된 달입니다. 해제 후 수정하세요.` }, { status: 409 });

  type LineIn = { id?: string; sku_id?: string | null; display_name?: string; qty?: number; unit_cost?: number; unit_price?: number; price_incl_vat?: boolean; note?: string | null };
  const rows = (body.lines as LineIn[]).map((l, i) => ({
    ...(l.id ? { id: String(l.id) } : {}),
    user_id: user.id,
    year_month: ym,
    sku_id: l.sku_id ? String(l.sku_id) : null,
    display_name: String(l.display_name ?? '').trim() || '(이름 없음)',
    qty: Math.max(0, Math.round(Number(l.qty) || 0)),
    unit_cost: Math.max(0, Number(l.unit_cost) || 0),
    unit_price: Math.max(0, Number(l.unit_price) || 0),
    price_incl_vat: !!l.price_incl_vat,
    note: l.note ? String(l.note) : null,
    sort_order: i,
    updated_at: new Date().toISOString(),
  }));

  // 기존 줄 중 목록에 없는 것만 삭제 (사용자가 화면에서 지운 줄)
  const { data: existing, error: exErr } = await admin.from('b2b_lines').select('id').eq('user_id', user.id).eq('year_month', ym);
  if (exErr) return NextResponse.json({ error: exErr.message, needsMigration: isMissing(exErr.message) }, { status: 400 });
  const keep = new Set(rows.map(r => r.id).filter((id): id is string => !!id));
  const drop = (existing ?? []).map(e => e.id).filter(id => !keep.has(id));
  if (drop.length) {
    const { error } = await admin.from('b2b_lines').delete().in('id', drop).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (rows.length) {
    const { error } = await admin.from('b2b_lines').upsert(rows, { onConflict: 'id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const { data } = await admin.from('b2b_lines').select(B2B_SELECT).eq('user_id', user.id).eq('year_month', ym).order('sort_order').order('created_at');
  return NextResponse.json({ ok: true, lines: data ?? [], deleted: drop.length });
}
