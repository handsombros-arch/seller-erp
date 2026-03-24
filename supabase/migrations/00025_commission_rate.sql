-- platform_skus에 수수료율 컬럼 추가 (판매대행수수료, 전자결제수수료 제외, VAT 제외)
ALTER TABLE platform_skus ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

-- 쿠팡 카테고리별 수수료 테이블 (xlsx 데이터 임포트용)
CREATE TABLE IF NOT EXISTS coupang_category_fees (
  category_id TEXT PRIMARY KEY,
  category_path TEXT NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL
);

ALTER TABLE coupang_category_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON coupang_category_fees FOR SELECT TO authenticated USING (true);
