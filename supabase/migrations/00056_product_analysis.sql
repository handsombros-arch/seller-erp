-- 상품별 순이익 분석을 위한 영속화 테이블 + 물류 등급 플래그
-- 5/22: 쿠팡 PA/NCA 광고 raw + calc-cost 매출 영속화

-- ────────────────────────────────────────────────────────────
-- 1) 상품별 매출 영속화 (calc-cost 적용 시 누적)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_product_sales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month    TEXT NOT NULL,                           -- 'YYYY-MM'
  platform      TEXT NOT NULL,                           -- 'coupang'|'toss'|'smartstore'|'esm'
  sku_id        UUID REFERENCES skus(id) ON DELETE SET NULL,  -- 매칭된 SKU (없으면 NULL)
  display_name  TEXT NOT NULL,                           -- calc-cost 결과의 표시명 (옵션 포함)
  qty           INTEGER NOT NULL DEFAULT 0,
  revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,        -- 적용된 매입원가 단가 (수기 수정 가능)
  total_cost    NUMERIC(14,2) NOT NULL DEFAULT 0,        -- unit_cost * qty
  match_method  TEXT,                                    -- 'ID'|'name'|'saved'|'unmatched'
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year_month, platform, display_name)
);

CREATE INDEX IF NOT EXISTS idx_mps_ym_plat ON monthly_product_sales(year_month, platform);
CREATE INDEX IF NOT EXISTS idx_mps_sku ON monthly_product_sales(sku_id);
CREATE INDEX IF NOT EXISTS idx_mps_user ON monthly_product_sales(user_id);

ALTER TABLE monthly_product_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_mps" ON monthly_product_sales
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 2) 상품별 광고비 영속화 (광고 raw 업로드 시 누적)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_product_ads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month      TEXT NOT NULL,                         -- 'YYYY-MM'
  platform        TEXT NOT NULL,                         -- 'coupang' 등
  ad_type         TEXT NOT NULL,                         -- 'pa'(상품광고) | 'nca'(신규구매) | 'live' | 'message' 등
  vendor_item_id  TEXT,                                  -- 옵션ID (광고집행 옵션ID). 없을 수도 있음
  sku_id          UUID REFERENCES skus(id) ON DELETE SET NULL,  -- 매핑된 SKU
  campaign_id     TEXT,
  campaign_name   TEXT,
  name            TEXT,                                  -- 광고집행 상품명
  cost            NUMERIC(14,2) NOT NULL DEFAULT 0,      -- 광고비 합계 (월)
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  conv_qty_14d    INTEGER NOT NULL DEFAULT 0,            -- 총 판매수량(14일)
  conv_rev_14d    NUMERIC(14,2) NOT NULL DEFAULT 0,      -- 총 전환매출액(14일)
  -- override 수동 매핑 (auto-match 안 될 때): vendor_item_id 가 NULL이거나 매핑 실패 시 사용자가 sku_id 직접 입력
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year_month, platform, ad_type, vendor_item_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_mpa_ym_plat ON monthly_product_ads(year_month, platform);
CREATE INDEX IF NOT EXISTS idx_mpa_sku ON monthly_product_ads(sku_id);
CREATE INDEX IF NOT EXISTS idx_mpa_vendor ON monthly_product_ads(vendor_item_id);
CREATE INDEX IF NOT EXISTS idx_mpa_user ON monthly_product_ads(user_id);

ALTER TABLE monthly_product_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_mpa" ON monthly_product_ads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 3) 상품 물류 등급 플래그 (쿠팡 물류비 4,100/4,850 분기)
-- ────────────────────────────────────────────────────────────
-- NULL  = 자동 판별 (상품명에 '하드' or '여행' 포함 시 oversize)
-- 'oversize'  = 강제 4,850 (예: 캐리어형, 대용량)
-- 'standard'  = 강제 4,100 (예: 상품명에 '여행' 있지만 실제 일반 사이즈)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS logistics_tier TEXT
    CHECK (logistics_tier IN ('standard', 'oversize'));

COMMENT ON COLUMN products.logistics_tier IS
  '쿠팡 물류비 등급 — NULL=자동(상품명 키워드), standard=4100원, oversize=4850원';
