import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { readTossRows, toYm } from '@/lib/settlement/tossAgg';

export const maxDuration = 30;

/**
 * GET /api/settlement/coverage?months=12
 * 달별 "무엇이 들어와 있나" 현황 — 시트 저장·마감, 매출 파일(플랫폼별 행·매출·적용일), 쿠팡 광고 월 집계, 토스 광고(raw 일수·기간·집계), B2B 줄.
 * 올리는 곳이 여러 군데(광고 분석 쿠팡/토스, 정산 매출 파일)라 한 화면에서 빠진 달을 찾기 위함.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const n = Math.min(24, Math.max(3, Number(request.nextUrl.searchParams.get('months')) || 12));
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const from = months[months.length - 1];
  const admin = await createAdminClient();

  const [snaps, closed, sales, ads, b2b, tossRaw] = await Promise.all([
    admin.from('monthly_cost_snapshots').select('year_month, amount').gte('year_month', from),
    admin.from('settlement_months').select('year_month, closed_at').gte('year_month', from),
    admin.from('monthly_product_sales').select('year_month, platform, qty, revenue, updated_at, sku_id').eq('user_id', user.id).gte('year_month', from),
    admin.from('monthly_product_ads').select('year_month, platform, cost, updated_at').eq('user_id', user.id).gte('year_month', from),
    admin.from('b2b_lines').select('year_month, qty').eq('user_id', user.id).gte('year_month', from),
    readTossRows(admin, user.id),
  ]);

  type Sales = { rows: number; qty: number; revenue: number; unmatched: number; updated_at: string | null };
  const out: Record<string, { sheet: { saved: boolean; items: number }; closed: string | null; sales: Record<string, Sales>; coupangAds: { rows: number; cost: number; updated_at: string | null } | null; tossAds: { rawRows: number; days: number; daysInMonth: number; first: string | null; last: string | null; cost: number; aggregated: boolean } | null; b2b: { lines: number; qty: number } | null }> = {};
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    out[m] = { sheet: { saved: false, items: 0 }, closed: null, sales: {}, coupangAds: null, tossAds: null, b2b: null };
    (out[m] as any).daysInMonth = new Date(y, mo, 0).getDate();
  }
  for (const s of (snaps.data ?? []) as any[]) { const o = out[s.year_month]; if (!o) continue; o.sheet.items += 1; if (Number(s.amount)) o.sheet.saved = true; }
  for (const c of (closed.data ?? []) as any[]) { const o = out[c.year_month]; if (o) o.closed = c.closed_at; }
  for (const r of (sales.data ?? []) as any[]) {
    const o = out[r.year_month]; if (!o) continue;
    const s = o.sales[r.platform] ?? (o.sales[r.platform] = { rows: 0, qty: 0, revenue: 0, unmatched: 0, updated_at: null });
    s.rows += 1; s.qty += Number(r.qty) || 0; s.revenue += Number(r.revenue) || 0; if (!r.sku_id) s.unmatched += 1;
    if (!s.updated_at || (r.updated_at && r.updated_at > s.updated_at)) s.updated_at = r.updated_at ?? s.updated_at;
  }
  for (const a of (ads.data ?? []) as any[]) {
    const o = out[a.year_month]; if (!o) continue;
    if (a.platform === 'coupang') { const c = o.coupangAds ?? (o.coupangAds = { rows: 0, cost: 0, updated_at: null }); c.rows += 1; c.cost += Number(a.cost) || 0; if (!c.updated_at || (a.updated_at && a.updated_at > c.updated_at)) c.updated_at = a.updated_at ?? c.updated_at; }
    if (a.platform === 'toss') { const t = o.tossAds ?? (o.tossAds = { rawRows: 0, days: 0, daysInMonth: (o as any).daysInMonth, first: null, last: null, cost: 0, aggregated: false }); t.aggregated = true; }
  }
  const tossDays = new Map<string, Set<string>>();
  for (const r of tossRaw) {
    const m = toYm(r['일자']); const o = out[m]; if (!o) continue;
    const t = o.tossAds ?? (o.tossAds = { rawRows: 0, days: 0, daysInMonth: (o as any).daysInMonth, first: null, last: null, cost: 0, aggregated: false });
    t.rawRows += 1; t.cost += Number(String(r['집행 광고비'] ?? '').replace(/[^0-9.-]/g, '')) || 0;
    const day = dayOf(r['일자']); if (day) { const set = tossDays.get(m) ?? new Set(); set.add(day); tossDays.set(m, set); if (!t.first || day < t.first) t.first = day; if (!t.last || day > t.last) t.last = day; }
  }
  for (const [m, set] of tossDays) { const t = out[m]?.tossAds; if (t) t.days = set.size; }
  for (const b of (b2b.data ?? []) as any[]) { const o = out[b.year_month]; if (!o) continue; const x = o.b2b ?? (o.b2b = { lines: 0, qty: 0 }); x.lines += 1; x.qty += Number(b.qty) || 0; }
  for (const m of months) delete (out[m] as any).daysInMonth;
  return NextResponse.json({ months, coverage: out, generatedAt: new Date().toISOString() });
}

/** '일자' → 'YYYY-MM-DD' (엑셀 serial / 20260801 / 2026-08-01) */
function dayOf(v: unknown): string | null {
  if (typeof v === 'number' && v > 25569) { const d = new Date((v - 25569) * 86400000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
  const s = String(v ?? '').replace(/\D/g, ''); return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}
