/**
 * 빈박스(리뷰용 발송) — 한 곳에만 적고 정산(월)·오가닉(기간)이 같은 값을 쓴다.
 * 원천 = empty_box_events (날짜 × 옵션ID × 수량). 정산의 monthly_product_sales.empty_qty 는 이 기록의 월 합계로 동기화된다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * 빈박스 재고 되돌리기. 주문 동기화가 이미 차감했지만 실제로 나가지 않은 수량을 재고에 더한다.
 * 같은 (월, 플랫폼) 의 이전 되돌림을 먼저 취소하고, 현재 저장된 empty_qty 로 다시 적용한다 (멱등).
 */
export async function restoreEmptyBoxes(admin: Admin, userId: string, yearMonth: string, platform: string): Promise<number> {
  const EMPTY_PREFIX = `emptybox:${yearMonth}:${platform}:`;
  let restored = 0;
  const { data: prev } = await admin.from('inventory_adjustments').select('id, sku_id, warehouse_id, reason').like('reason', `${EMPTY_PREFIX}%`);
  for (const a of prev ?? []) {
    const m = /:\+(\d+)$/.exec(String(a.reason)); const q = m ? Number(m[1]) : 0;
    if (q > 0) {
      const { data: inv } = await admin.from('inventory').select('quantity').eq('sku_id', a.sku_id).eq('warehouse_id', a.warehouse_id).maybeSingle();
      const before = Number(inv?.quantity ?? 0);
      await admin.from('inventory').update({ quantity: before - q, updated_at: new Date().toISOString() }).eq('sku_id', a.sku_id).eq('warehouse_id', a.warehouse_id);
    }
    await admin.from('inventory_adjustments').delete().eq('id', a.id);
  }
  const { data: rows } = await admin.from('monthly_product_sales').select('sku_id, empty_qty').eq('user_id', userId).eq('year_month', yearMonth).eq('platform', platform).gt('empty_qty', 0);
  for (const r of rows ?? []) {
    const q = Number(r.empty_qty) || 0;
    if (q <= 0 || !r.sku_id) continue;
    const { data: invs } = await admin.from('inventory').select('warehouse_id, quantity').eq('sku_id', r.sku_id).order('quantity', { ascending: false }).limit(1);
    const inv = invs?.[0];
    if (!inv) continue;
    const before = Number(inv.quantity ?? 0);
    await admin.from('inventory').update({ quantity: before + q, updated_at: new Date().toISOString() }).eq('sku_id', r.sku_id).eq('warehouse_id', inv.warehouse_id);
    await admin.from('inventory_adjustments').insert({ sku_id: r.sku_id, warehouse_id: inv.warehouse_id, before_quantity: before, after_quantity: before + q, reason: `${EMPTY_PREFIX}${r.sku_id}:+${q}`, adjusted_by: userId });
    restored += q;
  }
  return restored;
}

export const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }; };

/** 기간 안 빈박스 기록을 옵션ID 별로 합산 */
export async function sumEventsByVid(admin: Admin, userId: string, from: string, to: string): Promise<Map<string, number>> {
  const { data, error } = await admin.from('empty_box_events').select('vendor_item_id, qty').eq('user_id', userId).gte('date', from).lte('date', to);
  const m = new Map<string, number>();
  if (error) return m;
  for (const r of data ?? []) m.set(String(r.vendor_item_id), (m.get(String(r.vendor_item_id)) ?? 0) + (Number(r.qty) || 0));
  return m;
}

/**
 * 한 달의 정산 행(monthly_product_sales, 쿠팡)에 빈박스 기록의 월 합계를 반영하고 재고 되돌리기를 다시 맞춘다.
 * 옵션ID 가 없는 행(이름 매칭)은 건드리지 않는다.
 */
export async function syncMonthFromEvents(admin: Admin, userId: string, ym: string): Promise<{ updated: number; restored: number }> {
  const { from, to } = monthRange(ym);
  const sums = await sumEventsByVid(admin, userId, from, to);
  const { data: rows } = await admin.from('monthly_product_sales').select('id, vendor_item_id, qty, unit_cost, empty_qty').eq('user_id', userId).eq('year_month', ym).eq('platform', 'coupang').not('vendor_item_id', 'is', null);
  let updated = 0;
  for (const r of rows ?? []) {
    const want = Math.min(Number(r.qty) || 0, sums.get(String(r.vendor_item_id)) ?? 0);
    if ((Number(r.empty_qty) || 0) === want) continue;
    const unit = Number(r.unit_cost) || 0; const qty = Number(r.qty) || 0;
    const { error } = await admin.from('monthly_product_sales').update({ empty_qty: want, total_cost: unit * Math.max(0, qty - want), updated_at: new Date().toISOString() }).eq('id', r.id);
    if (!error) updated += 1;
  }
  let restored = 0;
  try { restored = await restoreEmptyBoxes(admin, userId, ym, 'coupang'); } catch { /* 재고 되돌리기 실패는 집계에 영향 없음 */ }
  return { updated, restored };
}

/** from~to 가 걸치는 달 목록 (YYYY-MM, 오름차순) */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const end = to.slice(0, 7);
  for (let i = 0; i < 36; i++) { const ym = `${y}-${String(m).padStart(2, '0')}`; out.push(ym); if (ym >= end) break; m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}

/** 마감된 달 집합 (settlement_months) */
export async function closedMonthSet(admin: Admin, yms: Iterable<string>): Promise<Set<string>> {
  const list = [...new Set(yms)];
  if (!list.length) return new Set();
  const { data } = await admin.from('settlement_months').select('year_month').in('year_month', list);
  return new Set((data ?? []).map((r: { year_month: string }) => String(r.year_month)));
}

export type MonthSync = { updated: number; restored: number; skipped?: 'closed' };

/** 여러 달을 기록 기준으로 동기화. 마감된 달은 손대지 않고 skipped 로 표시 */
export async function syncMonths(admin: Admin, userId: string, yms: Iterable<string>): Promise<Record<string, MonthSync>> {
  const list = [...new Set(yms)];
  const closed = await closedMonthSet(admin, list);
  const out: Record<string, MonthSync> = {};
  for (const ym of list) out[ym] = closed.has(ym) ? { updated: 0, restored: 0, skipped: 'closed' } : await syncMonthFromEvents(admin, userId, ym);
  return out;
}
