-- 월 마감 (2026-09-10)
-- 마감된 달은 시트 입력·매입원가 적용이 잠긴다. 해제는 확인 후 가능.
CREATE TABLE IF NOT EXISTS settlement_months (
  year_month TEXT PRIMARY KEY,               -- 'YYYY-MM'
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note       TEXT
);
ALTER TABLE settlement_months ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_settlement_months" ON settlement_months FOR ALL TO authenticated USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';
