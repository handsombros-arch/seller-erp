-- channel_orders: order_number + channel 중복 방지용 unique 제약
-- order_number가 NULL인 경우는 제외 (NULL은 unique 비교 대상 아님)
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_orders_number_channel
  ON channel_orders (order_number, channel)
  WHERE order_number IS NOT NULL;

-- naver_credentials 테이블 (없을 경우 생성)
CREATE TABLE IF NOT EXISTS naver_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE naver_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON naver_credentials FOR ALL TO authenticated USING (true) WITH CHECK (true);
