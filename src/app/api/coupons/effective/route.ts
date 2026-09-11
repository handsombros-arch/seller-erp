import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { effectiveByOption, loadCoupons, toCouponChannel } from '@/lib/settlement/coupons';

/**
 * 기간 × 옵션 유효 할인 — 상품별 순이익·오가닉 탭·대조 검산이 쓴다.
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&channel=]
 *  → { byVid: { "coupang|95840829178": { rate, amount, parts } }, bySku: { "coupang|<sku_id>": {...} }, count }
 * 개당 할인 = 판매가 × rate/100 + amount. rate·amount 는 기간에 걸친 시간 비율로 가중돼 있다.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from'), to = sp.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: 'from, to (YYYY-MM-DD) 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const r = await loadCoupons(admin, user.id, { channel: toCouponChannel(sp.get('channel')), from, to });
  const { byVid, bySku } = effectiveByOption(r.coupons, from, to);
  return NextResponse.json({ byVid: Object.fromEntries(byVid), bySku: Object.fromEntries(bySku), count: r.coupons.length, needsMigration: !!r.needsMigration });
}
