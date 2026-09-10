-- B2B 직거래 출고 내역 (2026-09-10)
-- 정산 시트 B2B 매출·매입원가를 SKU × 수량 줄 단위로 남긴다. 합계는 시트 기준값(대조)이 되고
-- 상품별 순이익에는 platform 'b2b' 매출 행으로 합성된다. 재고 차감은 하지 않는다 (추후 출고 구조 정리 때 일괄).
CREATE TABLE IF NOT EXISTS b2b_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  year_month   TEXT NOT NULL,                                  -- 'YYYY-MM'
  sku_id       UUID REFERENCES skus(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,                                  -- 선택 당시 상품명 + 옵션 (SKU 삭제돼도 남김)
  qty          INTEGER NOT NULL DEFAULT 0,
  unit_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,               -- 선택 당시 SKU 원가 (마스터와 같은 기준, 수정 가능)
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,               -- 공급단가 (세금계산서 공급가액 기준, VAT 별도)
  note         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_b2b_lines_user_ym ON b2b_lines(user_id, year_month);
ALTER TABLE b2b_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_b2b_lines" ON b2b_lines FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';
