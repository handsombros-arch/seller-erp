-- 경쟁상품 스냅샷의 키워드에 순위 컬럼 추가.
-- 텍스트 등장 순서가 곧 노출 기여도 순위(쿠팡 셀러 광고진단의 TOP 10 키워드).

ALTER TABLE competitor_snapshot_keywords
  ADD COLUMN IF NOT EXISTS rank integer;

CREATE INDEX IF NOT EXISTS idx_competitor_keywords_product_rank
  ON competitor_snapshot_keywords(product_id, rank);
