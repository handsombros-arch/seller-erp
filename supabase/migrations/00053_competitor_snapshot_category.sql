-- 경쟁상품 스냅샷에 카테고리 단위 메타데이터 추가.
-- 쿠팡 셀러 광고진단 페이지 헤더(카테고리 결과 섹션)에서 함께 긁어오는 값들.
-- 변화율은 텍스트에 부호가 안 들어와서 의미가 약해 컬럼에서 제외.

ALTER TABLE competitor_snapshots
  ADD COLUMN IF NOT EXISTS category_name      text,
  ADD COLUMN IF NOT EXISTS category_path      text[],
  ADD COLUMN IF NOT EXISTS total_impression   bigint,    -- 카테고리 전체 검색어 노출
  ADD COLUMN IF NOT EXISTS top100_impression  bigint,    -- TOP 100 상품의 검색어 노출
  ADD COLUMN IF NOT EXISTS top100_search_pct  numeric,   -- TOP 100 중 자연검색 비중
  ADD COLUMN IF NOT EXISTS top100_ad_pct      numeric,   -- TOP 100 중 광고 비중
  ADD COLUMN IF NOT EXISTS total_click        bigint;    -- 카테고리 전체 클릭

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_category
  ON competitor_snapshots(user_id, category_name, captured_at DESC);
