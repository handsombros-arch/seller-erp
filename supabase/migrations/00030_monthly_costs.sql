CREATE TABLE IF NOT EXISTS monthly_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  amount numeric DEFAULT 0,       -- VAT 제외 금액
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 기본 항목 삽입
INSERT INTO monthly_costs (label, amount, sort_order) VALUES
  ('인건비', 0, 1),
  ('SW비용', 0, 2),
  ('관리비', 0, 3),
  ('택배비', 0, 4),
  ('RG 보관비', 0, 5),
  ('기타비', 0, 6)
ON CONFLICT DO NOTHING;
