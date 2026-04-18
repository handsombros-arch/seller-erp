-- 월 고정비용 항목 잠금 (붙여넣기/초기화 시 값 유지)
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;
