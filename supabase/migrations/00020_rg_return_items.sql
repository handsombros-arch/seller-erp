CREATE TABLE IF NOT EXISTS rg_return_vendor_items (
  vendor_item_id text PRIMARY KEY,
  grade          text,
  created_at     timestamptz DEFAULT now()
);
