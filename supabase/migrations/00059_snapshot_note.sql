-- 정산 시트 비고를 월별로 저장 (2026-09-09)
-- 기존 monthly_costs.note 는 전역(모든 달 공통)이라 월마다 다른 메모를 남길 수 없었다.
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS note TEXT;
NOTIFY pgrst, 'reload schema';
