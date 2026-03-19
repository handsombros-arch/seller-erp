-- Channel sales table
CREATE TABLE IF NOT EXISTS channel_sales (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     TEXT    NOT NULL CHECK (channel IN ('smartstore', 'toss', 'coupang_direct', 'other')),
  sku_id      UUID    REFERENCES skus(id) ON DELETE SET NULL,
  product_name TEXT   NOT NULL,
  option_name TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  revenue     INTEGER DEFAULT 0,
  sale_date   DATE    NOT NULL,
  sale_date_end DATE,
  note        TEXT,
  batch_id    UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE channel_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_channel_sales" ON channel_sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- SKU-level sales tracking fields (manual input for 30d/7d averages)
ALTER TABLE skus ADD COLUMN IF NOT EXISTS sales_30d INTEGER DEFAULT 0;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS sales_7d  INTEGER DEFAULT 0;
