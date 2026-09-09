-- 정산 시트 저장 시점의 기준값(API/파일/설정)을 월별로 보존 (2026-09-09)
-- 수기 입력(amount)은 절대 덮어쓰지 않고, 비교용 기준값만 별도 컬럼에 둔다.
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS ref_amount NUMERIC;
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS ref_source TEXT;   -- 'API' | '파일' | '설정'
ALTER TABLE monthly_cost_snapshots ADD COLUMN IF NOT EXISTS ref_detail TEXT;
NOTIFY pgrst, 'reload schema';
