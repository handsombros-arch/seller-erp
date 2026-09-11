-- 빈박스(리뷰용 발송) 기록 — 한 곳에만 적는다 (2026-09-11)
-- 날짜 × 옵션ID × 수량. 정산 월(monthly_product_sales.empty_qty)과 오가닉 기간 집계가 모두 여기서 계산된다.
CREATE TABLE IF NOT EXISTS empty_box_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,                -- 발송일 (모르면 기간 마지막 날/월 말일로 기록)
  vendor_item_id  TEXT NOT NULL,                -- 쿠팡 옵션ID
  sku_id          UUID REFERENCES skus(id) ON DELETE SET NULL,
  qty             INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, vendor_item_id)
);
CREATE INDEX IF NOT EXISTS idx_ebe_user_date ON empty_box_events(user_id, date);
ALTER TABLE empty_box_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_ebe" ON empty_box_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';
