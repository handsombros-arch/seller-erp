-- 쿠팡 셀러 광고진단 페이지의 "TOP 20 경쟁상품 + 검색어 기여도" 페이스트 스냅샷.
-- 한 번 붙여넣을 때마다 한 스냅샷이 누적된다. 시간 흐름에 따른 추이 분석을 위해 사용.

-- 1) 스냅샷 (한 번의 페이스트 = 한 행)
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  my_product_name text,         -- 어떤 내 상품의 분석 결과인지 (선택)
  my_product_id   text,         -- 쿠팡 상품 ID (선택)
  memo            text,
  raw_text        text,         -- 원문 보관 (재파싱/디버깅용)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_user
  ON competitor_snapshots(user_id, captured_at DESC);

-- 2) 스냅샷의 경쟁상품 (한 스냅샷당 최대 20행)
CREATE TABLE IF NOT EXISTS competitor_snapshot_products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           uuid NOT NULL REFERENCES competitor_snapshots(id) ON DELETE CASCADE,
  rank                  integer NOT NULL,
  name                  text NOT NULL,
  released_at           date,
  review_score          numeric,
  review_count          integer,
  exposure              integer,         -- 검색어 노출
  exposure_change_pct   numeric,
  clicks                integer,
  clicks_change_pct     numeric,
  ctr                   numeric,         -- 클릭율 (%)
  ctr_change_pct        numeric,
  winner_price          integer,         -- 아이템위너 가격 (KRW)
  price_min             integer,
  price_max             integer,
  is_my_product         boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_competitor_products_snapshot
  ON competitor_snapshot_products(snapshot_id, rank);

-- 3) 상품별 기여 키워드 (상품당 최대 10행)
CREATE TABLE IF NOT EXISTS competitor_snapshot_keywords (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                uuid NOT NULL REFERENCES competitor_snapshot_products(id) ON DELETE CASCADE,
  keyword                   text NOT NULL,
  contributing_count        integer,         -- "내 상품 노출에 기여한 키워드 (N)" 의 N
  search_volume             integer,         -- 검색량
  search_volume_change_pct  numeric,
  exposure                  integer,         -- 검색어 노출
  exposure_change_pct       numeric,
  clicks                    integer,
  clicks_change_pct         numeric,
  avg_price                 integer,
  price_min                 integer,
  price_max                 integer
);

CREATE INDEX IF NOT EXISTS idx_competitor_keywords_product
  ON competitor_snapshot_keywords(product_id);

CREATE INDEX IF NOT EXISTS idx_competitor_keywords_keyword
  ON competitor_snapshot_keywords(keyword);
