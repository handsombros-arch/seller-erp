-- 상품문의 데이터 + 문의 분석 컬럼 추가
ALTER TABLE sourcing_analyses
  ADD COLUMN IF NOT EXISTS inquiries jsonb,
  ADD COLUMN IF NOT EXISTS inquiry_analysis jsonb,
  ADD COLUMN IF NOT EXISTS inquiries_count integer;
