-- SKU 하나에 같은 채널 옵션ID 여러 개 (2026-09-11)
-- 쿠팡은 같은 상품이 윙(판매자배송)과 로켓그로스 두 리스팅으로 있어 옵션ID·판매가가 다르다.
-- platform_skus 의 platform_sku_id 는 "기본" ID 로 두고, 나머지는 여기에 "추가 옵션ID" 로 둔다.
-- 모든 매칭(광고 raw·매출 파일·주문 동기화·RG 스냅샷·등록 큐)은 기본+추가 ID 를 같은 SKU 로 본다.
CREATE TABLE IF NOT EXISTS platform_sku_ids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id          UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform_sku_id TEXT NOT NULL,                 -- 옵션ID (쿠팡 vendorItemId / 토스 옵션 ID 등)
  label           TEXT,                          -- 구분 (예: 윙, 그로스, 재등록)
  price           NUMERIC(12,2),                 -- 이 리스팅의 판매가 (없으면 기본 ID 판매가)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, platform_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_sku_ids_sku ON platform_sku_ids(sku_id);
ALTER TABLE platform_sku_ids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_platform_sku_ids" ON platform_sku_ids FOR ALL TO authenticated USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';
