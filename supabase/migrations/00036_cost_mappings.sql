-- 플랫폼별 상품명 → 원가 매핑 (수기 입력 누적)
CREATE TABLE IF NOT EXISTS cost_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  product_name text NOT NULL,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(platform, product_name)
);
