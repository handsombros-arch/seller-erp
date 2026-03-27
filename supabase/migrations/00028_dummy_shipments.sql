-- 가배송(빈박스/리뷰용) 관리 테이블
CREATE TABLE IF NOT EXISTS dummy_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,           -- smartstore, toss, coupang_direct 등
  order_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  recipient TEXT,
  tracking_number TEXT,
  shipping_cost INTEGER NOT NULL DEFAULT 2650,  -- 배송비 (VAT 포함)
  jeju_surcharge BOOLEAN DEFAULT false,
  memo TEXT,                        -- 메모 (리뷰 요청 등)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, shipped, completed
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dummy_shipments_date ON dummy_shipments(order_date);
CREATE INDEX idx_dummy_shipments_channel ON dummy_shipments(channel);
