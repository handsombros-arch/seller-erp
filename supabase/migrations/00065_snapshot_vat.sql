-- 월별 VAT 구분 (2026-09-10)
-- 항목의 vat_applicable 은 기본값. 달마다 다르게 입력한 경우(7월 VAT 별도, 8월 VAT 포함) 그 달의 값을 스냅샷에 보존한다.
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS vat_applicable BOOLEAN;   -- NULL = 항목 기본값
NOTIFY pgrst, 'reload schema';
