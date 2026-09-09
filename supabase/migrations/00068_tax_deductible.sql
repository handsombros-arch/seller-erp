-- 경비 인정 여부 (2026-09-10)
-- 실제로는 나가지만 세무상 경비로 인정되지 않는 지출(대표 생활비, 원천징수 안 한 인건비, 개인 가구매 등).
-- 실제 손익(체감)에는 포함, 회계 손익(세무·대출용)에서는 제외.
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS tax_deductible BOOLEAN NOT NULL DEFAULT true;
NOTIFY pgrst, 'reload schema';
