-- 광고 보고서 업로드 파일 기록
CREATE TABLE IF NOT EXISTS ad_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, filename)
);

-- 광고 보고서 중복 제거된 원본 행
CREATE TABLE IF NOT EXISTS ad_raw_rows (
  dedup_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  filename TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_ad_raw_rows_created ON ad_raw_rows(created_at);
ALTER TABLE ad_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_raw_rows ENABLE ROW LEVEL SECURITY;

-- RLS: service role만 접근 (API 경유)
CREATE POLICY "service_role_ad_uploads" ON ad_uploads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_ad_raw_rows" ON ad_raw_rows FOR ALL USING (true) WITH CHECK (true);
