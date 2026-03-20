import type { SupabaseClient } from '@supabase/supabase-js';

// 주문 자동 차감 기록 식별자 (inventory_adjustments.reason prefix)
export const ORDER_NOTE_PREFIX = '__ORDER__:';

// 재고에 반영하지 않을 채널 (쿠팡RG는 자체 RG센터에서 출고 → 자사 창고 재고 불변)
const SKIP_CHANNELS = ['coupang_rg'];

// 취소/반품 완료된 주문은 차감 대상 아님
const CANCELED_STATUSES = ['CANCELED', 'CANCEL', 'CANCELLED', 'RETURN_DONE', 'CANCEL_DONE'];

export interface ApplyOrdersResult {
  applied: number;
  skipped: number;
  negativeSkuIds: string[];
}

/**
 * channel_orders를 기반으로 자사 창고 재고를 자동 차감합니다.
 *
 * 규칙:
 *  - 마지막 수기 재고 기입일(inventory_adjustments에서 ORDER 아닌 항목)의 익일부터의 주문만 반영
 *  - 한 번 반영된 주문은 다시 반영하지 않음 (inventory_adjustments reason = __ORDER__:orderNumber)
 *  - 재고 음수 허용 (경고 대상으로만 관리)
 */
export async function applyOrdersToInventory(
  admin: SupabaseClient,
  userId: string
): Promise<ApplyOrdersResult> {
  // 1. 이미 처리된 주문번호 수집
  const { data: doneAdj } = await admin
    .from('inventory_adjustments')
    .select('reason')
    .like('reason', `${ORDER_NOTE_PREFIX}%`);

  const doneSet = new Set((doneAdj ?? []).map((r: any) => r.reason as string));

  // 2. 처리 대상 주문 조회
  const { data: orders } = await admin
    .from('channel_orders')
    .select('order_number, channel, sku_id, quantity, order_date, order_status');

  const pending = (orders ?? []).filter((o: any) =>
    o.sku_id &&
    !SKIP_CHANNELS.includes(o.channel) &&
    !CANCELED_STATUSES.includes(o.order_status ?? '') &&
    !doneSet.has(`${ORDER_NOTE_PREFIX}${o.order_number}`)
  );

  if (pending.length === 0) return { applied: 0, skipped: 0, negativeSkuIds: [] };

  // 3. SKU별 마지막 수기 기입일 (ORDER prefix 아닌 adjustments 중 최신)
  const { data: manualAdj } = await admin
    .from('inventory_adjustments')
    .select('sku_id, created_at')
    .not('reason', 'like', `${ORDER_NOTE_PREFIX}%`)
    .order('created_at', { ascending: false });

  const lastManualDate = new Map<string, string>(); // sku_id → YYYY-MM-DD
  for (const adj of manualAdj ?? []) {
    if (!lastManualDate.has(adj.sku_id)) {
      lastManualDate.set(adj.sku_id, (adj.created_at as string).slice(0, 10));
    }
  }

  // 4. 창고별 재고 현황 (SKU당 재고 가장 많은 창고 우선)
  const { data: invRows } = await admin
    .from('inventory')
    .select('sku_id, warehouse_id, quantity')
    .order('quantity', { ascending: false });

  // 실시간 재고 추적용 맵 (반복 처리 중 누적 차감 반영)
  const invMap = new Map<string, { warehouse_id: string; quantity: number }>();
  for (const r of invRows ?? []) {
    if (!invMap.has(r.sku_id)) {
      invMap.set(r.sku_id, { warehouse_id: r.warehouse_id, quantity: r.quantity });
    }
  }

  // 기본 창고 (inventory 행 없는 SKU용)
  const { data: whs } = await admin.from('warehouses').select('id').limit(1);
  const defaultWhId = (whs?.[0] as any)?.id as string | undefined;

  let applied = 0;
  let skipped = 0;
  const negSet = new Set<string>();

  for (const order of pending) {
    // 마지막 수기 기입일 + 1일 이후 주문만 반영
    const lastManual = lastManualDate.get(order.sku_id);
    if (lastManual && order.order_date <= lastManual) {
      skipped++;
      continue;
    }

    const inv = invMap.get(order.sku_id);
    const warehouseId = inv?.warehouse_id ?? defaultWhId;
    if (!warehouseId) { skipped++; continue; }

    const currentQty = inv?.quantity ?? 0;
    const newQty = currentQty - order.quantity;

    // 재고 차감 (없으면 0으로 upsert 후 음수 허용)
    const { error } = await admin
      .from('inventory')
      .upsert(
        { sku_id: order.sku_id, warehouse_id: warehouseId, quantity: newQty },
        { onConflict: 'sku_id,warehouse_id' }
      );

    if (error) { skipped++; continue; }

    // 로컬 맵 업데이트 (같은 배치 내 다음 주문에 반영)
    invMap.set(order.sku_id, { warehouse_id: warehouseId, quantity: newQty });

    // 조정 기록
    await admin.from('inventory_adjustments').insert({
      sku_id: order.sku_id,
      warehouse_id: warehouseId,
      before_quantity: currentQty,
      after_quantity: newQty,
      reason: `${ORDER_NOTE_PREFIX}${order.order_number}`,
      adjusted_by: userId,
    });

    applied++;
    if (newQty < 0) negSet.add(order.sku_id);
  }

  return { applied, skipped, negativeSkuIds: [...negSet] };
}
