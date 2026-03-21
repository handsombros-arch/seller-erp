ALTER TABLE rg_return_vendor_items ADD COLUMN IF NOT EXISTS sku_id uuid REFERENCES skus(id) ON DELETE SET NULL;
