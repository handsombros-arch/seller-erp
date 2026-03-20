-- =============================================
-- 주문 데이터 기반 재고 자동 차감 & 판매 집계
-- =============================================

-- ── channel_orders 컬럼 추가 ───────────────────────────────────────────────
-- 재고 차감 여부 추적: upsert 시 중복 차감 방지 + 취소 시 복구에 사용
ALTER TABLE channel_orders
  ADD COLUMN IF NOT EXISTS inventory_deducted    BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deducted_warehouse_id UUID      REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ;

-- ── channel_sales channel 제약 확장 ───────────────────────────────────────
-- coupang(Wing), coupang_rg 추가
ALTER TABLE channel_sales
  DROP CONSTRAINT IF EXISTS channel_sales_channel_check;

ALTER TABLE channel_sales
  ADD CONSTRAINT channel_sales_channel_check
  CHECK (channel IN ('smartstore', 'toss', 'coupang', 'coupang_rg', 'coupang_direct', 'other'));

-- ── BEFORE INSERT 트리거: 신규 주문 재고 차감 ─────────────────────────────
-- coupang_rg 는 쿠팡창고 출고 → 자사 창고 차감 제외
-- sku_id 없으면 차감 불가 (SKU 매핑 선행 필요)
CREATE OR REPLACE FUNCTION deduct_inventory_on_order()
RETURNS TRIGGER AS $$
DECLARE
  v_wh UUID;
BEGIN
  IF NEW.sku_id IS NULL
     OR NEW.channel = 'coupang_rg'
     OR NEW.inventory_deducted
  THEN
    RETURN NEW;
  END IF;

  -- 자사/3PL 창고 중 재고가 가장 많은 창고 선택
  SELECT i.warehouse_id INTO v_wh
  FROM inventory i
  JOIN warehouses w ON i.warehouse_id = w.id
  WHERE i.sku_id = NEW.sku_id
    AND w.type IN ('own', '3pl')
    AND i.quantity > 0
  ORDER BY i.quantity DESC
  LIMIT 1;

  IF v_wh IS NOT NULL THEN
    UPDATE inventory
    SET quantity   = GREATEST(0, quantity - NEW.quantity),
        updated_at = NOW()
    WHERE sku_id = NEW.sku_id AND warehouse_id = v_wh;

    NEW.inventory_deducted    := TRUE;
    NEW.deducted_warehouse_id := v_wh;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_deduct_inventory
BEFORE INSERT ON channel_orders
FOR EACH ROW EXECUTE FUNCTION deduct_inventory_on_order();

-- ── BEFORE UPDATE 트리거: 재sync 시 차감 상태 보존 + 취소 시 재고 복구 ────
-- upsert DO UPDATE 가 inventory_deducted 를 FALSE 로 덮어쓰지 못하게 막음
CREATE OR REPLACE FUNCTION handle_channel_order_update()
RETURNS TRIGGER AS $$
DECLARE
  v_cancel_statuses TEXT[] := ARRAY[
    'CANCELLED', 'CANCEL', 'CANCEL_DONE',
    'RETURNED',  'RETURN', 'RETURN_DONE',
    'PURCHASE_CANCEL', 'VENDOR_CANCEL'
  ];
BEGIN
  -- 기존 차감 상태 보존 (upsert 재처리가 FALSE 로 덮어쓰지 않게)
  NEW.inventory_deducted    := OLD.inventory_deducted;
  NEW.deducted_warehouse_id := OLD.deducted_warehouse_id;

  -- 취소/반품으로 상태 변경 → 재고 복구
  IF OLD.inventory_deducted
     AND OLD.deducted_warehouse_id IS NOT NULL
     AND OLD.sku_id IS NOT NULL
     AND (OLD.order_status IS DISTINCT FROM NEW.order_status)
     AND NEW.order_status = ANY(v_cancel_statuses)
  THEN
    UPDATE inventory
    SET quantity   = quantity + OLD.quantity,
        updated_at = NOW()
    WHERE sku_id = OLD.sku_id AND warehouse_id = OLD.deducted_warehouse_id;

    NEW.inventory_deducted    := FALSE;
    NEW.deducted_warehouse_id := NULL;
    NEW.cancelled_at          := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channel_order_update
BEFORE UPDATE ON channel_orders
FOR EACH ROW EXECUTE FUNCTION handle_channel_order_update();

-- ── 인덱스 ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_channel_orders_sku     ON channel_orders(sku_id);
CREATE INDEX IF NOT EXISTS idx_channel_orders_deducted ON channel_orders(inventory_deducted) WHERE inventory_deducted = FALSE;
