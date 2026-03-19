CREATE TABLE IF NOT EXISTS channel_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          TEXT NOT NULL,
  order_date       DATE NOT NULL,
  product_name     TEXT NOT NULL,
  option_name      TEXT,
  order_number     TEXT,
  recipient        TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  shipping_cost    INTEGER DEFAULT 0,          -- 제주 할증 적용 후
  orig_shipping    INTEGER DEFAULT 0,          -- 원래 운임
  jeju_surcharge   BOOLEAN DEFAULT FALSE,       -- 제주/도서산간 여부
  tracking_number  TEXT,
  order_status     TEXT,
  address          TEXT,
  sku_id           UUID REFERENCES skus(id) ON DELETE SET NULL,
  batch_id         UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE channel_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON channel_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_channel_orders_date    ON channel_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_channel_orders_channel ON channel_orders(channel);
CREATE INDEX IF NOT EXISTS idx_channel_orders_batch   ON channel_orders(batch_id);
