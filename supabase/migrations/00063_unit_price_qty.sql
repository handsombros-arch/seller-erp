-- 단가 × 수량 항목 (2026-09-10)
-- 택배비 대형/소형/반품처럼 건당 단가가 정해진 항목은 수량만 적으면 금액이 계산된다.
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS unit_price NUMERIC;          -- 건당 단가 (VAT 포함/별도는 vat_applicable 따름)
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS qty INTEGER;        -- 그 달 수량
NOTIFY pgrst, 'reload schema';
