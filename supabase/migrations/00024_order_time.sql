-- 주문 시간 컬럼 추가
ALTER TABLE channel_orders ADD COLUMN IF NOT EXISTS order_time TEXT;
