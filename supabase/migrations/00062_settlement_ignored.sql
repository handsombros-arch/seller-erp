-- 등록 필요 큐 블랙리스트 (2026-09-10)
-- 사용자가 "숨기기"한 옵션ID/이름은 다시 큐에 나타나지 않는다. 복원 가능.
CREATE TABLE IF NOT EXISTS settlement_ignored (
  key        TEXT PRIMARY KEY,           -- 'vid:<옵션ID>' 또는 'name:<platform>:<표시명>'
  label      TEXT,
  reason     TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE settlement_ignored ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_settlement_ignored" ON settlement_ignored FOR ALL TO authenticated USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';
