-- 월 고정비용에 수입(+) 항목 지원
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS is_income boolean DEFAULT false;
