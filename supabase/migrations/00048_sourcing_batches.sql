-- 카테고리/베스트100 등 여러 상품을 묶어서 분석하는 배치
CREATE TABLE IF NOT EXISTS sourcing_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_url  text NOT NULL,
  source_type text NOT NULL DEFAULT 'category' CHECK (source_type IN ('category','best100','campaign','custom')),
  title       text,
  expand_limit integer NOT NULL DEFAULT 40,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','expanding','expanded','failed')),
  total_items integer,
  error       text,
  progress    jsonb,
  queued_at   timestamptz,
  started_at  timestamptz,
  expanded_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_batches_user ON sourcing_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_batches_status ON sourcing_batches(status);

ALTER TABLE sourcing_analyses
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES sourcing_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_rank integer;

CREATE INDEX IF NOT EXISTS idx_sourcing_analyses_batch ON sourcing_analyses(batch_id, batch_rank);

CREATE OR REPLACE FUNCTION sourcing_batches_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sourcing_batches_updated_at ON sourcing_batches;
CREATE TRIGGER trg_sourcing_batches_updated_at
BEFORE UPDATE ON sourcing_batches
FOR EACH ROW EXECUTE FUNCTION sourcing_batches_touch_updated_at();

NOTIFY pgrst, 'reload schema';
