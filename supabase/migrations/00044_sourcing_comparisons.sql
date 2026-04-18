-- 상품 비교 스냅샷 (수기 항목 포함)
CREATE TABLE IF NOT EXISTS sourcing_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  item_ids text[] NOT NULL,              -- sourcing_analyses.id 배열 (문자열로 보관)
  custom_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- custom_rows 구조: [{id, section, label, values: {[itemId]: string}}]
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_comparisons_user ON sourcing_comparisons(user_id, created_at DESC);

ALTER TABLE sourcing_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_sourcing_comparisons" ON sourcing_comparisons FOR ALL USING (true) WITH CHECK (true);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION sourcing_comparisons_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sourcing_comparisons_updated_at ON sourcing_comparisons;
CREATE TRIGGER trg_sourcing_comparisons_updated_at
BEFORE UPDATE ON sourcing_comparisons
FOR EACH ROW EXECUTE FUNCTION sourcing_comparisons_touch_updated_at();
