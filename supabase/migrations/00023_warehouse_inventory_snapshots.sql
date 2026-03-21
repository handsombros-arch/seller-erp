-- 창고 재고 일별 스냅샷 (추이 차트용)
CREATE TABLE IF NOT EXISTS warehouse_inventory_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date    DATE NOT NULL,
  sku_id           UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  warehouse_id     UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(snapshot_date, sku_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_wh_inv_snap_date ON warehouse_inventory_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_wh_inv_snap_sku ON warehouse_inventory_snapshots(sku_id);
