-- RG 재고 스냅샷에 상품명 추가 (반품재판매 자동 감지용)
ALTER TABLE rg_inventory_snapshots ADD COLUMN IF NOT EXISTS item_name text;
