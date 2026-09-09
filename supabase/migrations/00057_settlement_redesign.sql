-- 정산 재설계 1차 (2026-09-09)
-- 1) monthly_costs 에 손익 라인 / 마켓 / 배분 규칙 태그
-- 2) monthly_product_sales 빈박스 수량 (원가 제외)
-- 3) 광고 raw(ad_raw_rows) 월·옵션ID 집계 RPC — 상품별 광고비를 별도 업로드 없이 광고분석 raw 에서 계산
--
-- ⚠️ production 은 SQL Editor 로 수동 적용. 적용 후 NOTIFY pgrst 로 스키마 캐시 갱신.

ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS pl_line   TEXT;   -- revenue|coupon|cogs|market_fee|logistics|ad|marketing|fixed|other
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS market    TEXT;   -- coupang|toss|smartstore|esm|talkdeal|common
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS alloc_rule TEXT;  -- direct|by_orders|by_revenue|none
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS carry_forward BOOLEAN NOT NULL DEFAULT false; -- 새 달 열 때 전월 값 이월

ALTER TABLE monthly_product_sales ADD COLUMN IF NOT EXISTS empty_qty INTEGER NOT NULL DEFAULT 0; -- 빈박스(리뷰) 수량: 원가 제외

-- 광고 raw 월 집계: dedup_key 는 'YYYYMMDD|키워드|전환옵션ID|지면' 이라 prefix 로 월 필터 가능
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
LANGUAGE sql STABLE SECURITY DEFINER AS $$
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

-- 월별 보유 현황 (어느 달 raw 가 DB 에 있는지)
CREATE OR REPLACE FUNCTION settlement_ad_months(p_user UUID)
RETURNS TABLE (year_month TEXT, rows_count BIGINT, cost NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    substr(dedup_key, 1, 4) || '-' || substr(dedup_key, 5, 2) AS year_month,
    COUNT(*) AS rows_count,
    COALESCE(SUM(NULLIF(regexp_replace(data->>'광고비', '[^0-9.-]', '', 'g'), '')::numeric), 0) AS cost
  FROM ad_raw_rows
  WHERE user_id = p_user AND dedup_key ~ '^[0-9]{8}'
  GROUP BY 1
  ORDER BY 1 DESC
$$;

NOTIFY pgrst, 'reload schema';
