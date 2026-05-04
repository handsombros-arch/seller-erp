import type { SupabaseClient } from '@supabase/supabase-js';

export const ORDER_NOTE_PREFIX = '__ORDER__:';
const RESTORE_NOTE_PREFIX = '__RESTORE__:';

// 쿠팡RG는 자체 센터에서 출고 → 자사 창고 재고 불변
const SKIP_CHANNELS = ['coupang_rg'];

// 출고 반영할 상태 (실제 배송 시작 이후만 — 배송준비중 제외)
const SHIPPED_STATUSES = [
  // 스마트스토어
  'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED',
  // 토스
  'SHIPPING', 'PURCHASE_CONFIRMED',
  // 쿠팡 Wing
  'DELIVERING',
  // 공통
  '배송중', '배송완료',
];

// 반품 완료 상태만 재고 복구 (출고 후 반송된 건)
// 취소(결제취소)는 출고 전이므로 차감된 적 없음 → 복구 불필요
// 교환(EXCHANGE)은 별도 수동 처리 (뭘로 교환했는지 선택 필요)
const RETURN_STATUSES = [
  'RETURN_DONE', 'RETURNED', 'RETURN_COMPLETED',
];

export interface ApplyOrdersResult {
  applied: number;
  restored: number;
  skipped: number;
  negativeSkuIds: string[];
}

/**
 * channel_orders 기반 자사 창고 재고 자동 차감/복구
 *
 * 규칙:
 *  - 배송중 이상 상태 주문만 차감 (SHIPPED_STATUSES)
 *  - 이미 차감된 주문이 취소/반품 상태가 되면 복구
 *  - 쿠팡RG는 자체 센터이므로 skip
 *  - 마지막 수기 재고 기입일 이후 주문만 반영
 */
export async function applyOrdersToInventory(
  admin: SupabaseClient,
  userId: string
): Promise<ApplyOrdersResult> {
  // 1. 이미 처리된 주문번호 (차감/복구)
  const { data: adjRows } = await admin
    .from('inventory_adjustments')
    .select('reason')
    .or(`reason.like.${ORDER_NOTE_PREFIX}%,reason.like.${RESTORE_NOTE_PREFIX}%`);

  const deductedSet = new Set<string>();
  const restoredSet = new Set<string>();
  for (const r of adjRows ?? []) {
    const reason = r.reason as string;
    if (reason.startsWith(ORDER_NOTE_PREFIX)) deductedSet.add(reason.slice(ORDER_NOTE_PREFIX.length));
    if (reason.startsWith(RESTORE_NOTE_PREFIX)) restoredSet.add(reason.slice(RESTORE_NOTE_PREFIX.length));
  }

  // 2. 전체 주문 조회 — DB 트리거가 set 한 inventory_deducted/cancelled_at 도 같이 받아온다.
  // (트리거는 audit 를 안 쓰지만 inventory 자체는 이미 차감/복구한 상태 → 두 번째 차감 방지)
  const { data: orders } = await admin
    .from('channel_orders')
    .select(
      'order_number, channel, sku_id, quantity, order_date, order_status, claim_status, is_dummy, inventory_deducted, cancelled_at',
    );

  // 3. SKU별 마지막 수기 기입일
  const { data: manualAdj } = await admin
    .from('inventory_adjustments')
    .select('sku_id, created_at')
    .not('reason', 'like', `${ORDER_NOTE_PREFIX}%`)
    .not('reason', 'like', `${RESTORE_NOTE_PREFIX}%`)
    .order('created_at', { ascending: false });

  const lastManualDate = new Map<string, string>();
  for (const adj of manualAdj ?? []) {
    if (!lastManualDate.has(adj.sku_id)) {
      lastManualDate.set(adj.sku_id, (adj.created_at as string).slice(0, 10));
    }
  }

  // 4. 창고별 재고 현황
  const { data: invRows } = await admin
    .from('inventory')
    .select('sku_id, warehouse_id, quantity')
    .order('quantity', { ascending: false });

  const invMap = new Map<string, { warehouse_id: string; quantity: number }>();
  for (const r of invRows ?? []) {
    if (!invMap.has(r.sku_id)) {
      invMap.set(r.sku_id, { warehouse_id: r.warehouse_id, quantity: r.quantity });
    }
  }

  const { data: whs } = await admin.from('warehouses').select('id').limit(1);
  const defaultWhId = (whs?.[0] as any)?.id as string | undefined;

  let applied = 0;
  let restored = 0;
  let skipped = 0;
  const negSet = new Set<string>();

  for (const order of orders ?? []) {
    if (!order.sku_id || SKIP_CHANNELS.includes(order.channel) || order.is_dummy) continue;

    const orderNum = order.order_number as string;
    const orderStatus = (order.order_status ?? '').toUpperCase();
    const claimStatus = (order.claim_status ?? '').toUpperCase();
    // order_status 또는 claim_status 중 하나라도 해당하면 매칭
    const isShipped = SHIPPED_STATUSES.some((s) => orderStatus.includes(s.toUpperCase()));
    const isReturned = RETURN_STATUSES.some((s) => orderStatus.includes(s.toUpperCase()) || claimStatus.includes(s.toUpperCase()));

    // ── 트리거가 이미 처리한 케이스 — 이중 차감 방지 ─────────────────
    // BEFORE INSERT 트리거가 inventory 차감 + flag TRUE 까지 했지만 audit 는 안 남김.
    // applyOrders 가 처음 보면 deductedSet 에 없어 차감해버려 → 2배 차감.
    // 수정: flag TRUE 면 audit 만 백필하고 inventory 는 안 건드린다.
    if (order.inventory_deducted === true && !deductedSet.has(orderNum) && isShipped) {
      // audit 백필 — before/after 같음 (트리거가 이미 처리함을 기록만)
      const inv0 = invMap.get(order.sku_id);
      const wh0 = inv0?.warehouse_id ?? defaultWhId;
      if (wh0) {
        await admin.from('inventory_adjustments').insert({
          sku_id: order.sku_id,
          warehouse_id: wh0,
          before_quantity: inv0?.quantity ?? 0,
          after_quantity: inv0?.quantity ?? 0,
          reason: `${ORDER_NOTE_PREFIX}${orderNum}`,
          adjusted_by: userId,
        });
        deductedSet.add(orderNum);
      }
    }
    // 트리거가 UPDATE 시 cancelled_at 세팅 + inventory 복구 → 같은 패턴으로 audit 백필
    if (
      order.cancelled_at &&
      order.inventory_deducted === false &&
      deductedSet.has(orderNum) &&
      !restoredSet.has(orderNum)
    ) {
      const inv0 = invMap.get(order.sku_id);
      const wh0 = inv0?.warehouse_id ?? defaultWhId;
      if (wh0) {
        await admin.from('inventory_adjustments').insert({
          sku_id: order.sku_id,
          warehouse_id: wh0,
          before_quantity: inv0?.quantity ?? 0,
          after_quantity: inv0?.quantity ?? 0,
          reason: `${RESTORE_NOTE_PREFIX}${orderNum}`,
          adjusted_by: userId,
        });
        restoredSet.add(orderNum);
      }
    }

    // 수기 기입일 이후만 (기입일 당일 주문 포함)
    const lastManual = lastManualDate.get(order.sku_id);
    if (lastManual && order.order_date < lastManual) continue;

    const inv = invMap.get(order.sku_id);
    const warehouseId = inv?.warehouse_id ?? defaultWhId;
    if (!warehouseId) continue;
    const currentQty = inv?.quantity ?? 0;

    // Case A: 배송중 + 미차감 + 트리거도 미처리 → 차감
    // (이미 위 가드로 inventory_deducted=TRUE 면 deductedSet 에 이미 들어가 있음)
    if (isShipped && !deductedSet.has(orderNum) && order.inventory_deducted !== true) {
      const newQty = currentQty - order.quantity;
      const { error } = await admin
        .from('inventory')
        .upsert({ sku_id: order.sku_id, warehouse_id: warehouseId, quantity: newQty }, { onConflict: 'sku_id,warehouse_id' });
      if (error) { skipped++; continue; }

      invMap.set(order.sku_id, { warehouse_id: warehouseId, quantity: newQty });
      await admin.from('inventory_adjustments').insert({
        sku_id: order.sku_id, warehouse_id: warehouseId,
        before_quantity: currentQty, after_quantity: newQty,
        reason: `${ORDER_NOTE_PREFIX}${orderNum}`, adjusted_by: userId,
      });
      // applyOrders 가 처리한 건 트리거 외 경로니 직접 flag 도 세팅 (다음 sync 에서 트리거 안 탐)
      await admin
        .from('channel_orders')
        .update({ inventory_deducted: true, deducted_warehouse_id: warehouseId })
        .eq('order_number', orderNum)
        .eq('channel', order.channel);
      deductedSet.add(orderNum);
      applied++;
      if (newQty < 0) negSet.add(order.sku_id);
    }

    // Case B: 반품 완료 + 이미 차감됨 + 미복구 + 트리거도 복구 안 함 → 복구
    if (
      isReturned &&
      deductedSet.has(orderNum) &&
      !restoredSet.has(orderNum) &&
      !order.cancelled_at
    ) {
      const newQty = currentQty + order.quantity;
      const { error } = await admin
        .from('inventory')
        .upsert({ sku_id: order.sku_id, warehouse_id: warehouseId, quantity: newQty }, { onConflict: 'sku_id,warehouse_id' });
      if (error) { skipped++; continue; }

      invMap.set(order.sku_id, { warehouse_id: warehouseId, quantity: newQty });
      await admin.from('inventory_adjustments').insert({
        sku_id: order.sku_id, warehouse_id: warehouseId,
        before_quantity: currentQty, after_quantity: newQty,
        reason: `${RESTORE_NOTE_PREFIX}${orderNum}`, adjusted_by: userId,
      });
      await admin
        .from('channel_orders')
        .update({ inventory_deducted: false, cancelled_at: new Date().toISOString() })
        .eq('order_number', orderNum)
        .eq('channel', order.channel);
      restoredSet.add(orderNum);
      restored++;
    }
  }

  return { applied, restored, skipped, negativeSkuIds: [...negSet] };
}
