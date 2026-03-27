CREATE TABLE IF NOT EXISTS sku_grade_discounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  grade text NOT NULL,                -- 최상, 상, 중, 미개봉
  rate numeric NOT NULL DEFAULT 0,    -- 신상품 대비 비율 (85 = 85%)
  created_at timestamptz DEFAULT now(),
  UNIQUE(sku_id, grade)
);
