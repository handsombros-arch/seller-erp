import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const isMissing = (m: string) => /does not exist|schema cache|PGRST205/i.test(m);

/**
 * 추가 옵션ID — SKU 하나에 같은 채널 옵션ID 여러 개 (쿠팡 윙/그로스 등).
 * GET  ?sku_id=            → { ids: [{ id, sku_id, channel_id, platform_sku_id, label, price, channel }] , needsMigration? }
 * POST { sku_id, channel_id, platform_sku_id, label?, price? }  → 1건 upsert (channel_id+platform_sku_id 유일)
 * PUT  { sku_id, channel_id, ids: [{ platform_sku_id, label?, price? }] } → 그 SKU·채널의 추가 ID 를 이 목록으로 맞춤 (없는 건 삭제)
 * DELETE ?id=              → 1건 삭제
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  let q = admin.from('platform_sku_ids').select('id, sku_id, channel_id, platform_sku_id, label, price, created_at, channel:channels(id, name, type)').order('created_at');
  const skuId = request.nextUrl.searchParams.get('sku_id');
  if (skuId) q = q.eq('sku_id', skuId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ids: [], needsMigration: isMissing(error.message), error: error.message });
  return NextResponse.json({ ids: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const vid = String(b.platform_sku_id ?? '').trim();
  if (!b.sku_id || !b.channel_id || !vid) return NextResponse.json({ error: 'sku_id, channel_id, platform_sku_id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  // 기본 ID 와 같으면 추가로 넣지 않는다
  const { data: prim } = await admin.from('platform_skus').select('sku_id').eq('channel_id', b.channel_id).eq('platform_sku_id', vid).maybeSingle();
  if (prim && prim.sku_id === b.sku_id) return NextResponse.json({ ok: true, note: '이미 기본 옵션ID 입니다' });
  const { data, error } = await admin.from('platform_sku_ids').upsert({ sku_id: b.sku_id, channel_id: b.channel_id, platform_sku_id: vid, label: b.label ? String(b.label) : null, price: b.price == null || b.price === '' ? null : Number(b.price) }, { onConflict: 'channel_id,platform_sku_id' }).select().single();
  if (error) return NextResponse.json({ error: isMissing(error.message) ? '마이그레이션 00071(platform_sku_ids) 을 적용해 주세요' : error.message, needsMigration: isMissing(error.message) }, { status: 400 });
  return NextResponse.json({ ok: true, id: data });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  if (!b.sku_id || !b.channel_id || !Array.isArray(b.ids)) return NextResponse.json({ error: 'sku_id, channel_id, ids 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const want = (b.ids as any[]).map(x => ({ platform_sku_id: String(x.platform_sku_id ?? '').trim(), label: x.label ? String(x.label) : null, price: x.price == null || x.price === '' ? null : Number(x.price) })).filter(x => x.platform_sku_id);
  const { data: cur, error: curErr } = await admin.from('platform_sku_ids').select('id, platform_sku_id').eq('sku_id', b.sku_id).eq('channel_id', b.channel_id);
  if (curErr) return NextResponse.json({ error: isMissing(curErr.message) ? '마이그레이션 00071(platform_sku_ids) 을 적용해 주세요' : curErr.message, needsMigration: isMissing(curErr.message) }, { status: 400 });
  const keep = new Set(want.map(w => w.platform_sku_id));
  const drop = (cur ?? []).filter(c => !keep.has(String(c.platform_sku_id))).map(c => c.id);
  if (drop.length) { const { error } = await admin.from('platform_sku_ids').delete().in('id', drop); if (error) return NextResponse.json({ error: error.message }, { status: 400 }); }
  if (want.length) {
    const { error } = await admin.from('platform_sku_ids').upsert(want.map(w => ({ ...w, sku_id: b.sku_id, channel_id: b.channel_id })), { onConflict: 'channel_id,platform_sku_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, deleted: drop.length, saved: want.length });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const admin = await createAdminClient();
  const { error } = await admin.from('platform_sku_ids').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
