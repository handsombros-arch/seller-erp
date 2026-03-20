-- suppliers 테이블에 alias 컬럼 추가 (공급처 별칭 / 약칭)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS alias TEXT;
