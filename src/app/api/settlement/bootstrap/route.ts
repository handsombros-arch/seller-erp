import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/settlement/bootstrap?year_month=YYYY-MM
 * 정산 페이지 첫 화면에 필요한 것을 한 번에 — 항목 구조, 전체 월 스냅샷, 마감 월, 이 달 매출 파일 보유 마켓, 광고 집계 보유 월.
 * (예전엔 5~7개 API 를 동시에 불러 콜드 스타트가 겹치며 첫 로딩이 10~20초 걸렸다)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const ym = request.nextUrl.searchParams.get('year_month') ?? '';
  const admin = await createAdminClient();

  const snapQ = async () => {
    let r: any = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note, ref_amount, ref_source, ref_detail, qty, vat_applicable, vat_none').order('year_month', { ascending: false });
    if (r.error) r = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note, ref_amount, ref_source, ref_detail, qty, vat_applicable').order('year_month', { ascending: false });
    if (r.error) r = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note, ref_amount, ref_source, ref_detail, qty').order('year_month', { ascending: false });
    if (r.error) r = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note, ref_amount, ref_source, ref_detail').order('year_month', { ascending: false });
    if (r.error) r = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount, note').order('year_month', { ascending: false });
    if (r.error) r = await admin.from('monthly_cost_snapshots').select('year_month, cost_id, amount').order('year_month', { ascending: false });
    return r;
  };

  const [items, snaps, closed, sales, ads] = await Promise.all([
    admin.from('monthly_costs').select('*').order('sort_order', { ascending: true }),
    snapQ(),
    admin.from('settlement_months').select('year_month, closed_at, note'),
    ym ? admin.from('monthly_product_sales').select('platform').eq('user_id', user.id).eq('year_month', ym) : Promise.resolve({ data: [] as any[], error: null }),
    admin.from('monthly_product_ads').select('year_month, cost').eq('user_id', user.id).eq('platform', 'coupang'),
  ]);

  if (items.error) return NextResponse.json({ error: items.error.message }, { status: 400 });

  const adMonths = new Map<string, { rows_count: number; cost: number }>();
  for (const r of (ads.data ?? []) as any[]) { const a = adMonths.get(r.year_month) ?? { rows_count: 0, cost: 0 }; a.rows_count += 1; a.cost += Number(r.cost) || 0; adMonths.set(r.year_month, a); }

  return NextResponse.json({
    items: items.data ?? [],
    snapshots: snaps.data ?? [],
    closed: closed.error ? [] : (closed.data ?? []),
    closedSupported: !closed.error,
    salesPlatforms: [...new Set(((sales as any).data ?? []).map((r: any) => r.platform))],
    adMonths: [...adMonths.entries()].map(([year_month, v]) => ({ year_month, ...v })).sort((a, b) => b.year_month.localeCompare(a.year_month)),
  });
}
