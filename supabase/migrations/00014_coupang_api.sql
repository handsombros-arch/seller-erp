-- 쿠팡 Open API 자격증명 (단일 레코드)
CREATE TABLE IF NOT EXISTS coupang_credentials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_key text NOT NULL,
  secret_key text NOT NULL,
  vendor_id  text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE coupang_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON coupang_credentials FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 쿠팡 반품/취소 데이터
CREATE TABLE IF NOT EXISTS coupang_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      bigint UNIQUE NOT NULL,
  order_id       bigint,
  sku_id         uuid REFERENCES skus(id) ON DELETE SET NULL,
  vendor_item_id bigint,
  product_name   text NOT NULL,
  option_name    text,
  quantity       int NOT NULL DEFAULT 1,
  return_reason  text,
  return_type    text,   -- 'RETURN' | 'CANCEL'
  status         text,
  returned_at    date,
  created_at     timestamptz DEFAULT now()
);
ALTER TABLE coupang_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON coupang_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_coupang_returns_date ON coupang_returns(returned_at);

-- coupang_growth 채널 주문 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_orders_coupang_unique
  ON channel_orders(order_number, channel)
  WHERE order_number IS NOT NULL AND channel = 'coupang_growth';
