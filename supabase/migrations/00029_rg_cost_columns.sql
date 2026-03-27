-- 쿠팡 그로스 부대비용 컬럼 추가 (platform_skus)
ALTER TABLE platform_skus
  ADD COLUMN IF NOT EXISTS rg_fee_inout     numeric DEFAULT 0,  -- 입출고비 (건당)
  ADD COLUMN IF NOT EXISTS rg_fee_shipping  numeric DEFAULT 0,  -- 배송비 (건당)
  ADD COLUMN IF NOT EXISTS rg_fee_return    numeric DEFAULT 0,  -- 반품회수비 (건당)
  ADD COLUMN IF NOT EXISTS rg_fee_restock   numeric DEFAULT 0,  -- 반품재입고비 (건당)
  ADD COLUMN IF NOT EXISTS rg_fee_send      numeric DEFAULT 0,  -- 창고발송 배송비 (건당)
  ADD COLUMN IF NOT EXISTS rg_fee_packing   numeric DEFAULT 0;  -- 포장비 (건당)

-- 로켓그로스 세이버 구독 ON/OFF (coupang_credentials)
ALTER TABLE coupang_credentials
  ADD COLUMN IF NOT EXISTS rg_saver_enabled boolean DEFAULT false;  -- 월 99,000원(VAT별도)
