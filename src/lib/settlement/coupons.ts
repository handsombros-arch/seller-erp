/**
 * 쿠폰·할인 — 기간이 있는 쿠폰(coupons + coupon_items)을 "기간 × 옵션 → 개당 할인" 으로 바꾼다.
 * 순수 계산은 클라이언트에서도 쓴다(오가닉 탭·상품별 순이익). DB 읽기는 서버 전용.
 *
 * 규칙
 *  - 즉시할인(instant)과 다운로드(download)는 별개 쿠폰이며 둘 다 걸리면 합산.
 *  - 할인률(rate, %)은 판매가 × 률, 할인금액(amount, 원)은 그대로.
 *  - 기간 일부만 걸치면 걸친 시간 비율만큼만 반영 (일자별 판매량이 없어 시간 가중이 최선).
 *  - 채널(coupang·smartstore·toss)이 다르면 서로 무관.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type CouponChannel = 'coupang' | 'smartstore' | 'toss';
export type CouponKind = 'instant' | 'download';
export type DiscountType = 'rate' | 'amount';
export interface CouponItem { platform_sku_id: string; product_name: string | null; sku_id: string | null }
export interface Coupon {
  id: string; channel: CouponChannel; name: string; kind: CouponKind; discount_type: DiscountType; value: number;
  starts_at: string; ends_at: string | null; note: string | null; items: CouponItem[];
}
export const CHANNEL_LABEL: Record<CouponChannel, string> = { coupang: '쿠팡', smartstore: '스마트스토어', toss: '토스' };
export const KIND_LABEL: Record<CouponKind, string> = { instant: '즉시할인', download: '다운로드' };

const KST = '+09:00';
/** 날짜(YYYY-MM-DD) 기간을 KST 하루 시작~끝 ms 로 */
export function windowMs(from: string, to: string): { s: number; e: number } {
  return { s: new Date(`${from}T00:00:00${KST}`).getTime(), e: new Date(`${to}T23:59:59.999${KST}`).getTime() };
}
/** 쿠폰이 기간 안에 걸친 시간 비율 (0~1) */
export function overlapFraction(c: Pick<Coupon, 'starts_at' | 'ends_at'>, from: string, to: string): number {
  const { s, e } = windowMs(from, to);
  const cs = new Date(c.starts_at).getTime(); const ce = c.ends_at ? new Date(c.ends_at).getTime() : Infinity;
  const os = Math.max(s, cs), oe = Math.min(e, ce);
  if (!(oe > os) || e <= s) return 0;
  return Math.min(1, (oe - os) / (e - s));
}
export function couponStatus(c: Pick<Coupon, 'starts_at' | 'ends_at'>, now = Date.now()): 'upcoming' | 'active' | 'ended' {
  if (new Date(c.starts_at).getTime() > now) return 'upcoming';
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return 'ended';
  return 'active';
}

/** 기간 안 (채널, 옵션ID | sku_id) 별 유효 할인 — rate 는 % 합(시간 가중), amount 는 원 합(시간 가중) */
export interface Effective { rate: number; amount: number; parts: { name: string; kind: CouponKind; fraction: number; value: number; discount_type: DiscountType }[] }
export function effectiveByOption(coupons: Coupon[], from: string, to: string): { byVid: Map<string, Effective>; bySku: Map<string, Effective> } {
  const byVid = new Map<string, Effective>(); const bySku = new Map<string, Effective>();
  const get = (m: Map<string, Effective>, k: string) => { let v = m.get(k); if (!v) { v = { rate: 0, amount: 0, parts: [] }; m.set(k, v); } return v; };
  for (const c of coupons) {
    const f = overlapFraction(c, from, to); if (f <= 0) continue;
    for (const it of c.items) {
      const targets = [get(byVid, `${c.channel}|${it.platform_sku_id}`)];
      if (it.sku_id) targets.push(get(bySku, `${c.channel}|${it.sku_id}`));
      for (const t of targets) {
        if (c.discount_type === 'rate') t.rate += c.value * f; else t.amount += c.value * f;
        t.parts.push({ name: c.name, kind: c.kind, fraction: f, value: c.value, discount_type: c.discount_type });
      }
    }
  }
  return { byVid, bySku };
}
/** 개당 할인액 = 판매가 × rate% + amount */
export const unitDiscount = (e: Effective | undefined, unitPrice: number) => e ? Math.max(0, unitPrice * (e.rate / 100) + e.amount) : 0;

/** 채널 문자열 정규화 (channels.type · 정산 market 이름 → 쿠폰 채널) */
export function toCouponChannel(s: string | null | undefined): CouponChannel | null {
  const v = String(s ?? '').toLowerCase();
  if (v === 'coupang' || /쿠팡/.test(v)) return 'coupang';
  if (v === 'smartstore' || v === 'naver' || /스마트|스스|네이버/.test(v)) return 'smartstore';
  if (v === 'toss' || /토스/.test(v)) return 'toss';
  return null;
}

// ───────── 서버 전용 ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;
export const isMissingTable = (m: string) => /does not exist|schema cache|PGRST205/i.test(m);

/** 기간에 걸친 쿠폰(+옵션) 로드. from/to 없으면 전부. 테이블 없으면 needsMigration */
export async function loadCoupons(admin: Admin, userId: string, opt: { channel?: string | null; from?: string | null; to?: string | null } = {}): Promise<{ coupons: Coupon[]; needsMigration?: boolean; error?: string }> {
  let q = admin.from('coupons').select('id, channel, name, kind, discount_type, value, starts_at, ends_at, note, items:coupon_items(platform_sku_id, product_name, sku_id)').eq('user_id', userId).order('starts_at', { ascending: false });
  if (opt.channel) q = q.eq('channel', opt.channel);
  if (opt.from && opt.to) { const { s, e } = windowMs(opt.from, opt.to); q = q.lte('starts_at', new Date(e).toISOString()).or(`ends_at.is.null,ends_at.gte.${new Date(s).toISOString()}`); }
  const { data, error } = await q;
  if (error) return { coupons: [], needsMigration: isMissingTable(error.message), error: error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { coupons: (data ?? []).map((c: any) => ({ ...c, value: Number(c.value) || 0, items: (c.items ?? []).map((i: any) => ({ platform_sku_id: String(i.platform_sku_id), product_name: i.product_name ?? null, sku_id: i.sku_id ?? null })) })) };
}

/** 채널별 옵션ID → sku_id (기본 platform_skus + 추가 platform_sku_ids) */
export async function loadVidSkuMap(admin: Admin, channel: CouponChannel): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const [{ data: ps }, { data: extra }] = await Promise.all([
    admin.from('platform_skus').select('platform_sku_id, sku_id, channel:channels(type)'),
    admin.from('platform_sku_ids').select('platform_sku_id, sku_id, channel:channels(type)'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((ps ?? []) as any[])) if (p.platform_sku_id && toCouponChannel(p.channel?.type) === channel) m.set(String(p.platform_sku_id), p.sku_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((extra ?? []) as any[])) if (p.platform_sku_id && toCouponChannel(p.channel?.type) === channel && !m.has(String(p.platform_sku_id))) m.set(String(p.platform_sku_id), p.sku_id);
  return m;
}
