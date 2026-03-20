-- =============================================
-- 창고 재고 일자별 스냅샷
-- =============================================
-- inventory 테이블은 현재 수량만 관리 (덮어씀).
-- 이 테이블은 날짜별 재고 변화량 추적을 위한 히스토리용.
-- UNIQUE(snapshot_date, sku_id, warehouse_id) → 하루 1건, upsert로 최종값 유지.

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date        NOT NULL,
  sku_id        uuid        NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  warehouse_id  uuid        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity      int         NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, sku_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_snap_date ON inventory_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_snap_sku  ON inventory_snapshots(sku_id);

ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON inventory_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- 트리거: inventory 변경 시 오늘 날짜 스냅샷 자동 upsert
-- =============================================
-- 입출고 / 재고조정으로 inventory 행이 INSERT 또는 UPDATE 될 때마다
-- inventory_snapshots에 오늘(CURRENT_DATE) 기준으로 upsert.
-- 하루에 여러 번 변경되면 마지막 수치로 갱신됨.

CREATE OR REPLACE FUNCTION snapshot_inventory_on_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory_snapshots (snapshot_date, sku_id, warehouse_id, quantity)
  VALUES (CURRENT_DATE, NEW.sku_id, NEW.warehouse_id, NEW.quantity)
  ON CONFLICT (snapshot_date, sku_id, warehouse_id)
  DO UPDATE SET quantity = EXCLUDED.quantity;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_snapshot_inventory
AFTER INSERT OR UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION snapshot_inventory_on_change();

-- =============================================
-- 초기 스냅샷: 마이그레이션 실행 시점의 현재 재고를 오늘 날짜로 적재
-- =============================================
INSERT INTO inventory_snapshots (snapshot_date, sku_id, warehouse_id, quantity)
SELECT CURRENT_DATE, sku_id, warehouse_id, quantity
FROM inventory
ON CONFLICT (snapshot_date, sku_id, warehouse_id)
DO UPDATE SET quantity = EXCLUDED.quantity;
