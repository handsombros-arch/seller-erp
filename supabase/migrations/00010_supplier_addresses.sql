-- 공급처 연락처 및 주소 필드 추가
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone_country_code TEXT DEFAULT '+86';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS addresses JSONB DEFAULT '[]'::jsonb;
-- addresses 구조: [{"type": "office", "label": "쇼룸/사무실", "address": "..."}]
