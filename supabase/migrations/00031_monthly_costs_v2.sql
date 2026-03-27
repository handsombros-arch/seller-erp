-- monthly_costs v2: VAT 선택 + 세부항목(parent_id) + 월별 이력
ALTER TABLE monthly_costs
  ADD COLUMN IF NOT EXISTS vat_applicable boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES monthly_costs(id) ON DELETE CASCADE;

-- 인건비는 VAT 비과세
UPDATE monthly_costs SET vat_applicable = false WHERE label = '인건비';

-- 월별 이력 테이블
CREATE TABLE IF NOT EXISTS monthly_cost_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month text NOT NULL,          -- '2026-03'
  cost_id uuid REFERENCES monthly_costs(id) ON DELETE CASCADE,
  amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(year_month, cost_id)
);
