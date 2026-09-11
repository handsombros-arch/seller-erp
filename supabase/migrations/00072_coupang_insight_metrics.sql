-- 쿠팡 윙 비즈니스 인사이트 "상품별 판매 리포트" (2026-09-11)
-- 기간 합계 × 옵션ID. 판매방식(판매자배송/로켓그로스)이 같이 와서 같은 SKU 의 두 리스팅을 구분할 수 있다.
-- 용도: 총 판매(오가닉+광고) 기준 → 광고 raw 의 광고 전환 판매와 맞대 오가닉 비중, 주문 동기화 공백 보완.
-- 하루 단위로 내려받으면(확장/워커) period_from = period_to 라 일별 시계열이 된다.
CREATE TABLE IF NOT EXISTS coupang_insight_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  period_from       DATE NOT NULL,
  period_to         DATE NOT NULL,
  vendor_item_id    TEXT NOT NULL,                 -- 옵션 ID
  option_name       TEXT,                          -- 옵션명
  product_name      TEXT,                          -- 상품명
  product_id        TEXT,                          -- 등록상품ID
  category          TEXT,
  sales_method      TEXT,                          -- '판매자배송' | '로켓그로스'
  revenue           NUMERIC(14,2) NOT NULL DEFAULT 0,   -- 매출(원) (취소 반영)
  orders            INTEGER NOT NULL DEFAULT 0,
  qty               INTEGER NOT NULL DEFAULT 0,         -- 판매량 (취소 반영)
  visitors          INTEGER NOT NULL DEFAULT 0,
  views             INTEGER NOT NULL DEFAULT 0,
  carts             INTEGER NOT NULL DEFAULT 0,
  conv_rate         NUMERIC(8,4),                       -- 구매전환율 %
  winner_rate       NUMERIC(8,4),                       -- 아이템위너 비율 %
  gross_revenue     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- 총 매출(원)
  gross_qty         INTEGER NOT NULL DEFAULT 0,         -- 총 판매수
  cancel_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  cancel_qty        INTEGER NOT NULL DEFAULT 0,
  instant_cancel_qty INTEGER NOT NULL DEFAULT 0,
  sku_id            UUID REFERENCES skus(id) ON DELETE SET NULL,   -- 업로드 시 옵션ID 로 매칭
  source            TEXT DEFAULT 'upload',              -- 'upload' | 'extension' | 'worker'
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, period_from, period_to, vendor_item_id)
);
CREATE INDEX IF NOT EXISTS idx_cim_user_period ON coupang_insight_metrics(user_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS idx_cim_vid ON coupang_insight_metrics(vendor_item_id);
ALTER TABLE coupang_insight_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_cim" ON coupang_insight_metrics FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';
