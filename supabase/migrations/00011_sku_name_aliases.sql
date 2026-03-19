-- 채널 상품명 → SKU 매핑 마스터
CREATE TABLE IF NOT EXISTS sku_name_aliases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_name TEXT NOT NULL UNIQUE,  -- 채널에서 사용하는 상품명 (대소문자 무시 비교용 원본 저장)
  sku_id       UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sku_name_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON sku_name_aliases FOR ALL TO authenticated USING (true) WITH CHECK (true);
