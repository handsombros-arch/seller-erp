import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { loadCoupons, loadVidSkuMap, isMissingTable, toCouponChannel, type CouponChannel } from '@/lib/settlement/coupons';

/**
 * 쿠폰·할인 관리 (coupons + coupon_items, 마이그레이션 00075)
 * GET    ?channel=&from=&to=          → { coupons: [{..., items: [...]}] }  (from/to 없으면 전부)
 * POST   { channel, name, kind, discount_type, value, starts_at, ends_at, note, items: [{ platform_sku_id, product_name? }] } → 생성
 * PATCH  { id, ...같은 필드, items? } → 수정 (items 를 주면 통째로 교체)
 * DELETE ?id=                          → 삭제 (옵션도 같이)
 * 옵션ID → SKU 매칭은 저장 시 platform_skus + platform_sku_ids 로 자동.
 */
async function auth() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); return user; }
const isIso = (s: unknown) => typeof s === 'string' && !isNaN(new Date(s).getTime());

type ItemIn = { platform_sku_id?: string; product_name?: string | null };
function parseBody(b: Record<string, unknown>) {
  const channel = toCouponChannel(String(b.channel ?? ''));
  const kind = b.kind === 'download' ? 'download' : 'instant';
  const discount_type = b.discount_type === 'amount' ? 'amount' : 'rate';
  const value = Number(b.value);
  const errors: string[] = [];
  if (!channel) errors.push('channel 은 coupang | smartstore | toss');
  if (!String(b.name ?? '').trim()) errors.push('쿠폰명 필요');
  if (!isFinite(value) || value < 0) errors.push('할인 값 필요');
  if (discount_type === 'rate' && value > 100) errors.push('할인률은 100% 이하');
  if (!isIso(b.starts_at)) errors.push('시작 일시 필요');
  if (b.ends_at != null && b.ends_at !== '' && !isIso(b.ends_at)) errors.push('종료 일시 형식 오류');
  if (isIso(b.starts_at) && isIso(b.ends_at) && new Date(String(b.ends_at)) <= new Date(String(b.starts_at))) errors.push('종료가 시작보다 앞입니다');
  const items = Array.isArray(b.items) ? (b.items as ItemIn[]).map(i => ({ platform_sku_id: String(i.platform_sku_id ?? '').replace(/\.0$/, '').trim(), product_name: i.product_name ? String(i.product_name) : null })).filter(i => i.platform_sku_id) : null;
  return { channel: channel as CouponChannel, kind, discount_type, value, name: String(b.name ?? '').trim(), starts_at: new Date(String(b.starts_at)).toISOString(), ends_at: b.ends_at ? new Date(String(b.ends_at)).toISOString() : null, note: b.note ? String(b.note) : null, items, errors };
}
async function replaceItems(admin: Awaited<ReturnType<typeof createAdminClient>>, couponId: string, channel: CouponChannel, items: { platform_sku_id: string; product_name: string | null }[]) {
  const vid2sku = await loadVidSkuMap(admin, channel);
  await admin.from('coupon_items').delete().eq('coupon_id', couponId);
  const seen = new Set<string>();
  const rows = items.filter(i => { if (seen.has(i.platform_sku_id)) return false; seen.add(i.platform_sku_id); return true; }).map(i => ({ coupon_id: couponId, platform_sku_id: i.platform_sku_id, product_name: i.product_name, sku_id: vid2sku.get(i.platform_sku_id) ?? null }));
  if (!rows.length) return { saved: 0, matched: 0 };
  const { error } = await admin.from('coupon_items').insert(rows);
  if (error) throw new Error(error.message);
  return { saved: rows.length, matched: rows.filter(r => r.sku_id).length };
}

export async function GET(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const admin = await createAdminClient();
  const r = await loadCoupons(admin, user.id, { channel: toCouponChannel(sp.get('channel')), from: sp.get('from'), to: sp.get('to') });
  if (r.error && !r.needsMigration) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ coupons: r.coupons, needsMigration: !!r.needsMigration });
}

export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const p = parseBody(await request.json().catch(() => ({})));
  if (p.errors.length) return NextResponse.json({ error: p.errors.join(' · ') }, { status: 400 });
  const admin = await createAdminClient();
  const { data, error } = await admin.from('coupons').insert({ user_id: user.id, channel: p.channel, name: p.name, kind: p.kind, discount_type: p.discount_type, value: p.value, starts_at: p.starts_at, ends_at: p.ends_at, note: p.note }).select('id').single();
  if (error) return NextResponse.json({ error: isMissingTable(error.message) ? '마이그레이션 00075(coupons) 를 적용해 주세요' : error.message, needsMigration: isMissingTable(error.message) }, { status: 400 });
  try { const it = await replaceItems(admin, data.id, p.channel, p.items ?? []); return NextResponse.json({ ok: true, id: data.id, ...it }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? '');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { data: cur } = await admin.from('coupons').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!cur) return NextResponse.json({ error: '쿠폰을 찾을 수 없습니다' }, { status: 404 });
  const p = parseBody({ ...cur, ...b });
  if (p.errors.length) return NextResponse.json({ error: p.errors.join(' · ') }, { status: 400 });
  const { error } = await admin.from('coupons').update({ channel: p.channel, name: p.name, kind: p.kind, discount_type: p.discount_type, value: p.value, starts_at: p.starts_at, ends_at: p.ends_at, note: p.note, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  try { const it = b.items !== undefined ? await replaceItems(admin, id, p.channel, p.items ?? []) : null; return NextResponse.json({ ok: true, ...(it ?? {}) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { error } = await admin.from('coupons').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
