-- 플랫폼별 상품 매핑 테이블
CREATE TABLE platform_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform_product_name TEXT,      -- 플랫폼에 등록된 상품명
  platform_option_name TEXT,       -- 플랫폼 옵션명 (색상명 등)
  platform_product_id TEXT,        -- 플랫폼 상품 ID (API 연동용)
  platform_sku_id TEXT,            -- 플랫폼 옵션/SKU ID (API 연동용)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku_id, channel_id)
);

ALTER TABLE platform_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON platform_skus FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_platform_skus_sku ON platform_skus(sku_id);
CREATE INDEX idx_platform_skus_channel ON platform_skus(channel_id);
