-- 견적서 관리
CREATE TABLE quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  file_path TEXT,
  file_name TEXT,
  file_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  valid_until DATE,
  payment_terms TEXT,
  note TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  moq INTEGER,
  lead_time_days INTEGER,
  note TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX idx_quotation_items_sku ON quotation_items(sku_id);
CREATE INDEX idx_quotations_supplier ON quotations(supplier_id);
