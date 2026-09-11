import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { loadExtraVidMap } from '@/lib/settlement/extraIds';
import { sumEventsByVid, syncMonthFromEvents } from '@/lib/settlement/emptyBox';

const isMissing = (m: string) => /does not exist|schema cache|PGRST205/i.test(m);

/**
 * 빈박스(리뷰용 발송) 기록 — 정산과 오가닉 화면이 같이 쓰는 단 하나의 입력.
 * GET ?from&to                 → { byVid: { [옵션ID]: 합계 }, events: [...] }
 * PUT { period_from, period_to, vendor_item_id, total, note? }
 *     → 그 기간 합계가 total 이 되도록 기간 마지막 날 기록을 맞춘다 (다른 날짜 기록은 유지). qty 0 이면 삭제.
 *     → 걸친 달의 정산 행(monthly_product_sales 쿠팡, 옵션ID 일치)을 월 합계로 동기화 + 재고 되돌리기.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const from = request.nextUrl.searchParams.get('from'), to = request.nextUrl.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { data, error } = await admin.from('empty_box_events').select('id, date, vendor_item_id, sku_id, qty, note').eq('user_id', user.id).gte('date', from).lte('date', to).order('date');
  if (error) return NextResponse.json({ byVid: {}, events: [], needsMigration: isMissing(error.message), error: error.message });
  const byVid: Record<string, number> = {};
  for (const r of data ?? []) byVid[String(r.vendor_item_id)] = (byVid[String(r.vendor_item_id)] ?? 0) + (Number(r.qty) || 0);
  return NextResponse.json({ byVid, events: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const from = String(b.period_from ?? ''), to = String(b.period_to ?? ''), vid = String(b.vendor_item_id ?? '').trim();
  const total = Math.max(0, Math.round(Number(b.total) || 0));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || !vid) return NextResponse.json({ error: 'period_from ≤ period_to, vendor_item_id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  // 기간 안 다른 날짜 기록은 유지 → 마지막 날 기록 = total − 나머지
  const { data: existing, error: exErr } = await admin.from('empty_box_events').select('id, date, qty').eq('user_id', user.id).eq('vendor_item_id', vid).gte('date', from).lte('date', to);
  if (exErr) return NextResponse.json({ error: isMissing(exErr.message) ? '마이그레이션 00074(empty_box_events) 를 적용해 주세요' : exErr.message, needsMigration: isMissing(exErr.message) }, { status: 400 });
  const others = (existing ?? []).filter(e => e.date !== to).reduce((s, e) => s + (Number(e.qty) || 0), 0);
  const lastQty = total - others;
  if (lastQty < 0) return NextResponse.json({ error: `이 기간의 다른 날짜에 이미 ${others}개가 기록되어 있어 ${total}개로 줄일 수 없습니다. 날짜별 기록을 먼저 고치세요.` }, { status: 400 });
  // sku 매칭 (기본 + 추가 옵션ID)
  const [{ data: ps }, extra] = await Promise.all([admin.from('platform_skus').select('platform_sku_id, sku_id, channel:channels(type)').eq('platform_sku_id', vid), loadExtraVidMap(admin, 'coupang')]);
  const skuId = (ps ?? []).find((p: any) => (p.channel?.type ?? 'coupang') === 'coupang')?.sku_id ?? extra.get(vid) ?? null;
  if (lastQty === 0) {
    const { error } = await admin.from('empty_box_events').delete().eq('user_id', user.id).eq('vendor_item_id', vid).eq('date', to);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin.from('empty_box_events').upsert({ user_id: user.id, date: to, vendor_item_id: vid, sku_id: skuId, qty: lastQty, note: b.note ? String(b.note) : null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date,vendor_item_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // 걸친 달 정산 동기화
  const months = new Set<string>([from.slice(0, 7), to.slice(0, 7)]);
  const synced: Record<string, { updated: number; restored: number }> = {};
  for (const ym of months) synced[ym] = await syncMonthFromEvents(admin, user.id, ym);
  const byVid = await sumEventsByVid(admin, user.id, from, to);
  return NextResponse.json({ ok: true, total: byVid.get(vid) ?? 0, synced });
}
