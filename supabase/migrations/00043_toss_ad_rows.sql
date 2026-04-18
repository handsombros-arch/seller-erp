-- 토스 광고 데이터 (쿠팡 ad_raw_rows 와 동일 패턴)
CREATE TABLE IF NOT EXISTS toss_ad_rows (
  dedup_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  filename TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_toss_ad_rows_user ON toss_ad_rows(user_id, created_at DESC);

ALTER TABLE toss_ad_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_toss_ad_rows" ON toss_ad_rows FOR ALL USING (true) WITH CHECK (true);
