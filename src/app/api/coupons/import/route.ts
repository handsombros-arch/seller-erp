import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { loadVidSkuMap, isMissingTable, toCouponChannel } from '@/lib/settlement/coupons';

/**
 * 엑셀 가져오기 — 사용자가 관리하던 시트 구조(상품명 · 쿠폰명 · 옵션ID · 종 · 할인률 · 시작 · 종료) 그대로.
 * POST { channel, rows: [{ 상품명, 쿠폰명, 옵션ID, 종, 할인률|할인금액|할인, 시작|시작일, 종료|종료일 }], replace?: boolean }
 *  - 같은 (채널, 쿠폰명, 종, 시작 일시) 쿠폰이 이미 있으면 그 쿠폰의 값·종료·옵션을 새 파일로 교체 (재업로드 = 최신본)
 *  - replace=true 면 그 채널의 기존 쿠폰 중 파일에 없는 것도 삭제 (한 달 단위로 파일 전체를 갱신할 때)
 * 열 이름은 공백·대소문자 무시, 비슷한 이름도 받는다. 시작·종료는 엑셀 날짜(숫자)도, '2026-09-01 00:00' 문자열도 받는다.
 */
async function auth() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); return user; }

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(row);
  for (const n of names) { const k = keys.find(k => norm(k) === norm(n)); if (k !== undefined && row[k] !== '' && row[k] != null) return row[k]; }
  for (const n of names) { const k = keys.find(k => norm(k).includes(norm(n))); if (k !== undefined && row[k] !== '' && row[k] != null) return row[k]; }
  return undefined;
}
/** 엑셀 일시 → ISO. 숫자(엑셀 serial, 한국 시각)·Date·문자열 모두 */
function parseWhen(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number') { const ms = Math.round((v - 25569) * 86400 * 1000); return new Date(ms - 9 * 3600 * 1000).toISOString(); }   // 엑셀 serial 은 시간대 없음 → KST 로 본다
  const s = String(v).trim().replace(/\./g, '-').replace(/\//g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  return new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${se.padStart(2, '0')}+09:00`).toISOString();
}
/** '10%' → rate 10 · '1,000원' / 1000 → amount 1000 · 숫자만 있고 100 이하면 률 */
function parseDiscount(v: unknown, explicitAmount: unknown): { discount_type: 'rate' | 'amount'; value: number } {
  if (explicitAmount != null && explicitAmount !== '') { const n = Number(String(explicitAmount).replace(/[^0-9.]/g, '')); if (isFinite(n) && n > 0) return { discount_type: 'amount', value: n }; }
  const s = String(v ?? '').trim();
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return { discount_type: 'rate', value: 0 };
  if (/%|률|율/.test(s)) return { discount_type: 'rate', value: n };
  if (/원|₩|,/.test(s)) return { discount_type: 'amount', value: n };
  if (typeof v === 'number' && v > 0 && v < 1) return { discount_type: 'rate', value: v * 100 };   // 엑셀 % 서식(0.1)
  return n <= 100 ? { discount_type: 'rate', value: n } : { discount_type: 'amount', value: n };
}
const parseKind = (v: unknown): 'instant' | 'download' => /다운|down/i.test(String(v ?? '')) ? 'download' : 'instant';

export async function POST(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const channel = toCouponChannel(String(b.channel ?? ''));
  if (!channel) return NextResponse.json({ error: 'channel 은 coupang | smartstore | toss' }, { status: 400 });
  const rows: Record<string, unknown>[] = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return NextResponse.json({ error: 'rows 필요' }, { status: 400 });

  // 행 → 쿠폰 묶음
  type G = { name: string; kind: 'instant' | 'download'; discount_type: 'rate' | 'amount'; value: number; starts_at: string; ends_at: string | null; items: Map<string, string | null> };
  const groups = new Map<string, G>(); const skipped: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = String(pick(r, '쿠폰명', '쿠폰이름', '쿠폰') ?? '').trim();
    const vid = String(pick(r, '옵션ID', '옵션 ID', '옵션아이디', 'vendorItemId', '옵션') ?? '').replace(/\.0$/, '').trim();
    const starts = parseWhen(pick(r, '시작일시', '시작일', '시작', '시작기간', 'start'));
    const ends = parseWhen(pick(r, '종료일시', '종료일', '종료', '종료기간', 'end'));
    if (!name || !vid || !starts) { skipped.push(`${i + 2}행 (${!name ? '쿠폰명' : !vid ? '옵션ID' : '시작'} 없음)`); continue; }
    const kind = parseKind(pick(r, '종', '종류', '유형', '구분', 'kind'));
    const disc = parseDiscount(pick(r, '할인률', '할인율', '할인', 'rate'), pick(r, '할인금액', '할인액', 'amount'));
    const key = `${name}|${kind}|${starts}`;
    let g = groups.get(key);
    if (!g) { g = { name, kind, discount_type: disc.discount_type, value: disc.value, starts_at: starts, ends_at: ends, items: new Map() }; groups.set(key, g); }
    g.items.set(vid, String(pick(r, '상품명', '상품', '옵션명') ?? '') || null);
  }
  if (!groups.size) return NextResponse.json({ error: `쿠폰을 읽지 못했습니다. 열 이름을 확인하세요 (쿠폰명 · 옵션ID · 종 · 할인률 · 시작 · 종료). ${skipped.slice(0, 3).join(', ')}` }, { status: 400 });

  const admin = await createAdminClient();
  const vid2sku = await loadVidSkuMap(admin, channel);
  const { data: existing, error: exErr } = await admin.from('coupons').select('id, name, kind, starts_at').eq('user_id', user.id).eq('channel', channel);
  if (exErr) return NextResponse.json({ error: isMissingTable(exErr.message) ? '마이그레이션 00075(coupons) 를 적용해 주세요' : exErr.message, needsMigration: isMissingTable(exErr.message) }, { status: 400 });
  const exKey = new Map((existing ?? []).map(c => [`${c.name}|${c.kind}|${new Date(c.starts_at).toISOString()}`, c.id]));
  let created = 0, updated = 0, items = 0, matched = 0; const touched = new Set<string>();
  for (const [key, g] of groups) {
    let id = exKey.get(key);
    if (id) {
      const { error } = await admin.from('coupons').update({ discount_type: g.discount_type, value: g.value, ends_at: g.ends_at, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      updated++;
    } else {
      const { data, error } = await admin.from('coupons').insert({ user_id: user.id, channel, name: g.name, kind: g.kind, discount_type: g.discount_type, value: g.value, starts_at: g.starts_at, ends_at: g.ends_at, note: '엑셀 가져오기' }).select('id').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      id = data.id; created++;
    }
    touched.add(id!);
    await admin.from('coupon_items').delete().eq('coupon_id', id);
    const rowsIn = [...g.items].map(([vid, pname]) => ({ coupon_id: id, platform_sku_id: vid, product_name: pname, sku_id: vid2sku.get(vid) ?? null }));
    const { error } = await admin.from('coupon_items').insert(rowsIn);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    items += rowsIn.length; matched += rowsIn.filter(r => r.sku_id).length;
  }
  let removed = 0;
  if (b.replace) {
    const gone = (existing ?? []).filter(c => !touched.has(c.id)).map(c => c.id);
    if (gone.length) { const { error } = await admin.from('coupons').delete().in('id', gone); if (!error) removed = gone.length; }
  }
  return NextResponse.json({ ok: true, coupons: groups.size, created, updated, removed, items, matched, unmatched: items - matched, skipped });
}
