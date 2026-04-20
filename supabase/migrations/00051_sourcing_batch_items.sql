-- 배치 ↔ 분석 many-to-many: 기존 분석을 재사용하는 배치 연결
CREATE TABLE IF NOT EXISTS sourcing_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES sourcing_batches(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES sourcing_analyses(id) ON DELETE CASCADE,
  batch_rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, analysis_id)
);

CREATE INDEX IF NOT EXISTS idx_sourcing_batch_items_batch ON sourcing_batch_items(batch_id, batch_rank);
CREATE INDEX IF NOT EXISTS idx_sourcing_batch_items_analysis ON sourcing_batch_items(analysis_id);

-- 기존 sourcing_analyses.batch_id 기반 연결을 sourcing_batch_items 로 backfill
INSERT INTO sourcing_batch_items (batch_id, analysis_id, batch_rank)
SELECT batch_id, id, batch_rank FROM sourcing_analyses
WHERE batch_id IS NOT NULL
ON CONFLICT (batch_id, analysis_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
