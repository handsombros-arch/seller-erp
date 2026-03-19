-- 출고 기록에 쿠팡 센터명 추가
ALTER TABLE outbound_records ADD COLUMN IF NOT EXISTS coupang_center TEXT;
