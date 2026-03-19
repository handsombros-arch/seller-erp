-- purchase_orders status CHECK 제약에 'transiting' 추가
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'ordered', 'transiting', 'partial', 'completed', 'cancelled'));
