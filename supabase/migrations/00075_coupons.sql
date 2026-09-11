-- 쿠폰·할인 관리 (2026-09-11)
-- 마스터의 platform_skus.coupon_discount(고정값) 대신, 기간이 있는 쿠폰을 따로 둔다.
-- 엑셀 관리 구조 그대로: 쿠폰 하나에 옵션 여러 개, 즉시할인/다운로드 별개, 채널(쿠팡·스스·토스) 별개, 시작·종료는 시각까지.
-- 쓰는 곳: 상품별 순이익(월), 오가닉 vs 광고(기간), 대조 검산 쿠폰 기준값.
CREATE TABLE IF NOT EXISTS coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,                       -- coupang | smartstore | toss
  name            TEXT NOT NULL,                       -- 쿠폰명 (마켓에 등록한 이름)
  kind            TEXT NOT NULL DEFAULT 'instant',     -- instant(즉시할인) | download(다운로드)
  discount_type   TEXT NOT NULL DEFAULT 'rate',        -- rate(%) | amount(원)
  value           NUMERIC(12,2) NOT NULL DEFAULT 0,    -- 할인률(%) 또는 할인금액(원)
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,                         -- NULL = 종료일 없음(진행 중)
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coupons_user_channel_period ON coupons(user_id, channel, starts_at, ends_at);
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_coupons" ON coupons FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS coupon_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  platform_sku_id TEXT NOT NULL,                       -- 옵션ID (쿠팡 vendorItemId / 스스·토스 옵션 ID)
  product_name    TEXT,                                -- 엑셀의 상품명 (표시용)
  sku_id          UUID REFERENCES skus(id) ON DELETE SET NULL,   -- 옵션ID 로 매칭된 SKU
  UNIQUE(coupon_id, platform_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_items_vid ON coupon_items(platform_sku_id);
ALTER TABLE coupon_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_coupon_items" ON coupon_items FOR ALL
  USING (EXISTS (SELECT 1 FROM coupons c WHERE c.id = coupon_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM coupons c WHERE c.id = coupon_id AND c.user_id = auth.uid()));
NOTIFY pgrst, 'reload schema';
