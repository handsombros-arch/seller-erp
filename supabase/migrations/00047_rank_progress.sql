-- 워커 진행도 표시용
ALTER TABLE snapshot_keywords
  ADD COLUMN IF NOT EXISTS progress jsonb,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE rank_keywords
  ADD COLUMN IF NOT EXISTS progress jsonb,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
