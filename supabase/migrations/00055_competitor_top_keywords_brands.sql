-- 카테고리 분석에 TOP 20 검색어 + TOP 브랜드 두 종류 페이지 추가.
-- competitor_snapshots 의 product 단위 상세(competitor_snapshot_products)와는 별개로,
-- 카테고리 단위 검색어/브랜드 집계를 별도 테이블로 보관한다. 한 snapshot 에 세 종류 모두
-- 누적될 수 있다 (사용자가 페이지를 한 종류씩 페이스트하면 각각 채워짐).

-- ── TOP 20 검색어 (카테고리 단위) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_snapshot_top_keywords (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id               uuid NOT NULL REFERENCES competitor_snapshots(id) ON DELETE CASCADE,
  rank                      integer NOT NULL,
  keyword                   text NOT NULL,
  contributing_count        integer,         -- 내 상품 노출에 기여한 키워드 (N) 의 N
  search_volume             integer,
  search_volume_change_pct  numeric,
  exposure                  integer,
  exposure_change_pct       numeric,
  clicks                    integer,
  clicks_change_pct         numeric,
  avg_price                 integer,
  price_min                 integer,
  price_max                 integer
);

CREATE INDEX IF NOT EXISTS idx_competitor_top_keywords_snapshot
  ON competitor_snapshot_top_keywords(snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_competitor_top_keywords_keyword
  ON competitor_snapshot_top_keywords(keyword);

-- ── TOP 브랜드 (카테고리 단위) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_snapshot_top_brands (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           uuid NOT NULL REFERENCES competitor_snapshots(id) ON DELETE CASCADE,
  rank                  integer NOT NULL,
  brand_name            text NOT NULL,
  exposure              integer,
  exposure_change_pct   numeric,
  clicks                integer,
  clicks_change_pct     numeric,
  ctr                   numeric,
  ctr_change_pct        numeric
);

CREATE INDEX IF NOT EXISTS idx_competitor_top_brands_snapshot
  ON competitor_snapshot_top_brands(snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_competitor_top_brands_brand
  ON competitor_snapshot_top_brands(brand_name);
