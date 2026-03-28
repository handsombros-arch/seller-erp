-- 세부항목 비고란 추가
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
