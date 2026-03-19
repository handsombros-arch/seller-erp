-- 발주서에 입고 유형 추가 (수입/국내 구매 등)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS inbound_type TEXT DEFAULT 'import';
-- 'import' = 해외수입 (중국 등), 'local' = 국내구매

-- 출고에 유형, 박스수, 쿠팡 도착 예정일 추가
ALTER TABLE outbound_records ADD COLUMN IF NOT EXISTS outbound_type TEXT DEFAULT 'coupang_growth';
-- 'coupang_growth' = 쿠팡 로켓그로스, 'other' = 기타

ALTER TABLE outbound_records ADD COLUMN IF NOT EXISTS box_count INTEGER;
ALTER TABLE outbound_records ADD COLUMN IF NOT EXISTS arrival_date DATE;
-- arrival_date: 쿠팡 창고 도착 예정일 (달력에서 이 날짜 기준으로 표시)
