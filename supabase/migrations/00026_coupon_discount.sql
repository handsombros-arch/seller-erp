-- 쿠폰 할인금액 (수기 입력, 다운로드 쿠폰 등 API 미반영 할인)
ALTER TABLE platform_skus ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(12,2) DEFAULT 0;
