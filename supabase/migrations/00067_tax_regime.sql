-- 과세 유형(간이/일반) 설정 + 항목 VAT 구분 확인 (2026-09-10)
CREATE TABLE IF NOT EXISTS settlement_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE settlement_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_settlement_settings" ON settlement_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- 일반과세 전환 월 (이 달부터 일반과세자 기준). 없으면 2027-01
INSERT INTO settlement_settings (key, value) VALUES ('tax_switch_ym', '2027-01') ON CONFLICT (key) DO NOTHING;

-- 항목 VAT 구분을 사용자가 확인했는지 (세무 체크 카드)
ALTER TABLE monthly_costs ADD COLUMN IF NOT EXISTS vat_confirmed BOOLEAN NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
