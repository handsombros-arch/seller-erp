-- =============================================
-- seller-erp 초기 스키마
-- =============================================

-- 창고
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'own' CHECK (type IN ('own', 'coupang', '3pl', 'other')),
  location TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 판매 채널
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('coupang', 'toss', 'smartstore', 'other')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 상품
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  image_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SKU (상품 옵션 조합)
CREATE TABLE skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku_code TEXT UNIQUE NOT NULL,
  option_values JSONB DEFAULT '{}',
  barcode TEXT,
  cost_price NUMERIC(12, 2) DEFAULT 0,
  lead_time_days INTEGER DEFAULT 7,
  reorder_point INTEGER DEFAULT 0,
  safety_stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 재고 (창고별 SKU 수량)
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku_id, warehouse_id)
);

-- 발주서
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE,
  supplier TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partial', 'completed', 'cancelled')),
  order_date DATE,
  expected_date DATE,
  total_amount NUMERIC(15, 2) DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 발주 항목
CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES skus(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12, 2) DEFAULT 0,
  received_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 입고 기록
CREATE TABLE inbound_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_item_id UUID REFERENCES purchase_order_items(id),
  sku_id UUID NOT NULL REFERENCES skus(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12, 2),
  inbound_date DATE NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 출고 기록
CREATE TABLE outbound_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES skus(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  channel_id UUID REFERENCES channels(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2),
  outbound_date DATE NOT NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 재고 조정 기록 (실사, 파손, 샘플 등)
CREATE TABLE inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES skus(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  before_quantity INTEGER NOT NULL,
  after_quantity INTEGER NOT NULL,
  reason TEXT,
  adjusted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_skus_product ON skus(product_id);
CREATE INDEX idx_inventory_sku ON inventory(sku_id);
CREATE INDEX idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX idx_inbound_sku ON inbound_records(sku_id);
CREATE INDEX idx_inbound_date ON inbound_records(inbound_date);
CREATE INDEX idx_outbound_sku ON outbound_records(sku_id);
CREATE INDEX idx_outbound_date ON outbound_records(outbound_date);
CREATE INDEX idx_outbound_channel ON outbound_records(channel_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);

-- =============================================
-- RLS (인증된 사용자 전체 접근)
-- =============================================
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON warehouses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON channels FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON skus FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inbound_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON outbound_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inventory_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- 기본 데이터
-- =============================================
INSERT INTO warehouses (name, type) VALUES
  ('자사창고', 'own'),
  ('쿠팡 그로스', 'coupang');

INSERT INTO channels (name, type) VALUES
  ('쿠팡', 'coupang'),
  ('토스', 'toss'),
  ('스마트스토어', 'smartstore');

-- =============================================
-- 재고 자동 업데이트 함수 (입출고 시 트리거)
-- =============================================
CREATE OR REPLACE FUNCTION update_inventory_on_inbound()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (sku_id, warehouse_id, quantity)
  VALUES (NEW.sku_id, NEW.warehouse_id, NEW.quantity)
  ON CONFLICT (sku_id, warehouse_id)
  DO UPDATE SET
    quantity = inventory.quantity + NEW.quantity,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inbound_update_inventory
AFTER INSERT ON inbound_records
FOR EACH ROW EXECUTE FUNCTION update_inventory_on_inbound();

CREATE OR REPLACE FUNCTION update_inventory_on_outbound()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory
  SET quantity = GREATEST(0, quantity - NEW.quantity),
      updated_at = NOW()
  WHERE sku_id = NEW.sku_id AND warehouse_id = NEW.warehouse_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbound_update_inventory
AFTER INSERT ON outbound_records
FOR EACH ROW EXECUTE FUNCTION update_inventory_on_outbound();

-- PO 번호 자동 생성
CREATE SEQUENCE po_number_seq START 1001;
CREATE OR REPLACE FUNCTION set_po_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.po_number IS NULL THEN
    NEW.po_number := 'PO-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('po_number_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_po_number
BEFORE INSERT ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION set_po_number();
