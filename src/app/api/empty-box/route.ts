import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { loadExtraVidMap } from '@/lib/settlement/extraIds';
import { sumEventsByVid, syncMonths, monthsBetween, closedMonthSet } from '@/lib/settlement/emptyBox';

const isMissing = (m: string) => /does not exist|schema cache|PGRST205/i.test(m);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * 빈박스(리뷰용 발송) 기록 — 정산과 오가닉 화면이 같이 쓰는 단 하나의 입력. 원천 = empty_box_events (날짜 × 옵션ID × 수량).
 * GET    ?from&to                                   → { byVid: { [옵션ID]: 합계 }, events: [...], closed: [마감된 달] }
 * PUT    { period_from, period_to, vendor_item_id, total, date?, note? }
 *        → 그 기간 합계가 total 이 되도록 date(없으면 기간 마지막 날) 기록을 맞춘다. 다른 날짜 기록은 유지. 0 이면 삭제.
 *        → 기간이 두 달에 걸치면 date 가 필수 (어느 달 정산에 넣을지 명시). 마감된 달의 날짜는 거부(409).
 * POST   { date, vendor_item_id, qty, note? }       → 날짜 기록 하나를 그 값으로 (0 이면 삭제). 마감된 달 거부.
 * DELETE ?id=                                       → 기록 하나 삭제. 마감된 달 거부.
 * 어느 경로든 걸친 달의 정산 행(monthly_product_sales 쿠팡, 옵션ID 일치)을 월 합계로 동기화하고 재고 되돌리기를 다시 맞춘다. 마감된 달은 건너뛴다.
 */
async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
async function skuFor(admin: Awaited<ReturnType<typeof createAdminClient>>, vid: string): Promise<string | null> {
  const [{ data: ps }, extra] = await Promise.all([admin.from('platform_skus').select('platform_sku_id, sku_id, channel:channels(type)').eq('platform_sku_id', vid), loadExtraVidMap(admin, 'coupang')]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ps ?? []).find((p: any) => (p.channel?.type ?? 'coupang') === 'coupang')?.sku_id ?? extra.get(vid) ?? null;
}
const closedError = (ym: string) => NextResponse.json({ error: `${ym} 은 마감된 달입니다. 정산에서 마감을 해제한 뒤 고치세요.`, closed: ym }, { status: 409 });

export async function GET(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const from = request.nextUrl.searchParams.get('from'), to = request.nextUrl.searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const [{ data, error }, closed] = await Promise.all([
    admin.from('empty_box_events').select('id, date, vendor_item_id, sku_id, qty, note').eq('user_id', user.id).gte('date', from).lte('date', to).order('date'),
    closedMonthSet(admin, monthsBetween(from, to)),
  ]);
  if (error) return NextResponse.json({ byVid: {}, events: [], closed: [...closed], needsMigration: isMissing(error.message), error: error.message });
  const byVid: Record<string, number> = {};
  for (const r of data ?? []) byVid[String(r.vendor_item_id)] = (byVid[String(r.vendor_item_id)] ?? 0) + (Number(r.qty) || 0);
  return NextResponse.json({ byVid, events: data ?? [], closed: [...closed] });
}

export async function PUT(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const from = String(b.period_from ?? ''), to = String(b.period_to ?? ''), vid = String(b.vendor_item_id ?? '').trim();
  const total = Math.max(0, Math.round(Number(b.total) || 0));
  if (!isYmd(from) || !isYmd(to) || from > to || !vid) return NextResponse.json({ error: 'period_from ≤ period_to, vendor_item_id 필요' }, { status: 400 });
  const spans = monthsBetween(from, to);
  let date = b.date ? String(b.date) : '';
  if (date) {
    if (!isYmd(date) || date < from || date > to) return NextResponse.json({ error: 'date 는 기간 안의 날짜여야 합니다' }, { status: 400 });
  } else if (spans.length > 1) {
    return NextResponse.json({ error: `이 기간은 ${spans.join('·')} 두 달 이상에 걸쳐 있습니다. 빈박스를 어느 달에 넣을지 골라 주세요.`, needsDate: true, months: spans }, { status: 400 });
  } else date = to;
  const admin = await createAdminClient();
  const closed = await closedMonthSet(admin, [date.slice(0, 7)]);
  if (closed.size) return closedError(date.slice(0, 7));
  // 기간 안 다른 날짜 기록은 유지 → date 기록 = total − 나머지
  const { data: existing, error: exErr } = await admin.from('empty_box_events').select('id, date, qty').eq('user_id', user.id).eq('vendor_item_id', vid).gte('date', from).lte('date', to);
  if (exErr) return NextResponse.json({ error: isMissing(exErr.message) ? '마이그레이션 00074(empty_box_events) 를 적용해 주세요' : exErr.message, needsMigration: isMissing(exErr.message) }, { status: 400 });
  const others = (existing ?? []).filter(e => e.date !== date).reduce((s, e) => s + (Number(e.qty) || 0), 0);
  const dayQty = total - others;
  if (dayQty < 0) return NextResponse.json({ error: `이 기간의 다른 날짜에 이미 ${others}개가 기록되어 있어 ${total}개로 줄일 수 없습니다. 기록 목록에서 날짜별로 고치세요.` }, { status: 400 });
  const skuId = await skuFor(admin, vid);
  if (dayQty === 0) {
    const { error } = await admin.from('empty_box_events').delete().eq('user_id', user.id).eq('vendor_item_id', vid).eq('date', date);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin.from('empty_box_events').upsert({ user_id: user.id, date, vendor_item_id: vid, sku_id: skuId, qty: dayQty, note: b.note ? String(b.note) : null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date,vendor_item_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const synced = await syncMonths(admin, user.id, spans);
  const byVid = await sumEventsByVid(admin, user.id, from, to);
  return NextResponse.json({ ok: true, total: byVid.get(vid) ?? 0, date, synced });
}

export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const date = String(b.date ?? ''), vid = String(b.vendor_item_id ?? '').trim();
  const qty = Math.max(0, Math.round(Number(b.qty) || 0));
  if (!isYmd(date) || !vid) return NextResponse.json({ error: 'date(YYYY-MM-DD), vendor_item_id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const ym = date.slice(0, 7);
  if ((await closedMonthSet(admin, [ym])).size) return closedError(ym);
  if (qty === 0) {
    const { error } = await admin.from('empty_box_events').delete().eq('user_id', user.id).eq('vendor_item_id', vid).eq('date', date);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const skuId = await skuFor(admin, vid);
    const { error } = await admin.from('empty_box_events').upsert({ user_id: user.id, date, vendor_item_id: vid, sku_id: skuId, qty, note: b.note ? String(b.note) : null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date,vendor_item_id' });
    if (error) return NextResponse.json({ error: isMissing(error.message) ? '마이그레이션 00074(empty_box_events) 를 적용해 주세요' : error.message }, { status: 400 });
  }
  const synced = await syncMonths(admin, user.id, [ym]);
  return NextResponse.json({ ok: true, synced });
}

export async function DELETE(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { data: ev } = await admin.from('empty_box_events').select('id, date').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!ev) return NextResponse.json({ error: '기록을 찾을 수 없습니다' }, { status: 404 });
  const ym = String(ev.date).slice(0, 7);
  if ((await closedMonthSet(admin, [ym])).size) return closedError(ym);
  const { error } = await admin.from('empty_box_events').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const synced = await syncMonths(admin, user.id, [ym]);
  return NextResponse.json({ ok: true, synced });
}
