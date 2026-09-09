-- 정산 광고 raw 집계 성능 (2026-09-09)
-- 00057 의 RPC 가 statement timeout 에 걸림 (ad_raw_rows 수십만 행 전체 스캔).
-- 1) dedup_key prefix(LIKE 'YYYYMM%') 를 인덱스로 타도록 text_pattern_ops 인덱스
-- 2) 월 보유 현황은 JSONB 를 건드리지 않고 키만 센다
-- 3) 함수 단위 statement_timeout 상향

CREATE INDEX IF NOT EXISTS idx_ad_raw_rows_user_dedup_prefix
  ON ad_raw_rows (user_id, dedup_key text_pattern_ops);

CREATE OR REPLACE FUNCTION settlement_ad_months(p_user UUID)
RETURNS TABLE (year_month TEXT, rows_count BIGINT, cost NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
  SELECT
    substr(dedup_key, 1, 4) || '-' || substr(dedup_key, 5, 2) AS year_month,
    COUNT(*) AS rows_count,
    0::numeric AS cost
  FROM ad_raw_rows
  WHERE user_id = p_user AND dedup_key >= '2' AND dedup_key < '3'
  GROUP BY 1
  ORDER BY 1 DESC
$$;

CREATE OR REPLACE FUNCTION settlement_ad_by_option(p_user UUID, p_prefix TEXT)
RETURNS TABLE (
  vendor_item_id TEXT,
  product_name   TEXT,
  cost           NUMERIC,
  impressions    BIGINT,
  clicks         BIGINT,
  conv_qty_14d   BIGINT,
  conv_rev_14d   NUMERIC,
  rows_count     BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
  SELECT
    COALESCE(NULLIF(data->>'광고집행 옵션ID', ''), '')                             AS vendor_item_id,
    MAX(NULLIF(data->>'광고집행 상품명', ''))                                        AS product_name,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'광고비', '[^0-9.-]', '', 'g'), '')::numeric), 0)            AS cost,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'노출수', '[^0-9.-]', '', 'g'), '')::numeric), 0)::bigint    AS impressions,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'클릭수', '[^0-9.-]', '', 'g'), '')::numeric), 0)::bigint    AS clicks,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'총 판매수량(14일)', '[^0-9.-]', '', 'g'), '')::numeric), 0)::bigint AS conv_qty_14d,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'총 전환매출액(14일)', '[^0-9.-]', '', 'g'), '')::numeric), 0)       AS conv_rev_14d,
    COUNT(*)                                                                         AS rows_count
  FROM ad_raw_rows
  WHERE user_id = p_user AND dedup_key LIKE p_prefix || '%'
  GROUP BY 1
$$;

NOTIFY pgrst, 'reload schema';
