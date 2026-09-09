-- VAT 없음 항목 (2026-09-10)
-- 급여·프리랜서·개인 거래·부가세 납부액처럼 부가세가 없는 금액은 별도/포함 어느 보기에서도 그대로여야 한다.
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS vat_none BOOLEAN NOT NULL DEFAULT false;           -- 항목 기본값
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS vat_none BOOLEAN;                            -- 달별 (NULL = 기본값)
NOTIFY pgrst, 'reload schema';
