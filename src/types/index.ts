export interface SupplierAddress {
  type: 'office' | 'factory' | 'other';
  label: string;
  address: string;
}

export interface Supplier {
  id: string;
  name: string;
  alias: string | null;
  contact_person: string | null;
  phone_country_code: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
  lead_time_days: number;
  main_products: string | null;
  note: string | null;
  addresses: SupplierAddress[];
  is_active: boolean;
  created_at: string;
}

export interface Warehouse {
  id: string;
  name: string;
  type: 'own' | 'coupang' | '3pl' | 'other';
  location: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'coupang' | 'toss' | 'smartstore' | 'other';
  is_active: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  image_url: string | null;
  description: string | null;
  created_at: string;
  skus?: Sku[];
}

export interface Sku {
  id: string;
  product_id: string;
  sku_code: string;
  option_values: Record<string, string>; // {"색상": "블랙", "사이즈": "M"}
  barcode: string | null;
  cost_price: number;
  logistics_cost: number;
  manual_daily_avg: number | null;
  supplier_id: string | null;
  lead_time_days: number;
  reorder_point: number;
  safety_stock: number;
  sales_30d: number;
  sales_7d: number;
  is_active: boolean;
  created_at: string;
  product?: Product;
  inventory?: InventoryItem[];
}

export interface ChannelSale {
  id: string;
  channel: 'smartstore' | 'toss' | 'coupang_direct' | 'other';
  sku_id: string | null;
  product_name: string;
  option_name: string | null;
  quantity: number;
  revenue: number;
  sale_date: string;
  sale_date_end: string | null;
  note: string | null;
  batch_id: string | null;
  created_at: string;
  sku?: Sku;
}

export interface InventoryItem {
  id: string;
  sku_id: string;
  warehouse_id: string;
  quantity: number;
  updated_at: string;
  sku?: Sku;
  warehouse?: Warehouse;
}

export interface PurchaseOrder {
  id: string;
  po_number: string | null;
  supplier: string | null;
  status: 'draft' | 'ordered' | 'transiting' | 'partial' | 'completed' | 'cancelled';
  inbound_type: 'import' | 'local';
  order_date: string | null;
  expected_date: string | null;
  total_amount: number;
  note: string | null;
  created_at: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  sku_id: string;
  quantity: number;
  unit_cost: number;
  received_quantity: number;
  sku?: Sku;
}

export interface InboundRecord {
  id: string;
  po_item_id: string | null;
  sku_id: string;
  warehouse_id: string;
  quantity: number;
  unit_cost: number | null;
  inbound_date: string;
  note: string | null;
  created_at: string;
  sku?: Sku;
  warehouse?: Warehouse;
}

export interface OutboundRecord {
  id: string;
  sku_id: string;
  warehouse_id: string;
  channel_id: string | null;
  quantity: number;
  unit_price: number | null;
  outbound_date: string;
  outbound_type: 'coupang_growth' | 'other';
  box_count: number | null;
  arrival_date: string | null;
  coupang_center: string | null;
  note: string | null;
  created_at: string;
  sku?: Sku;
  warehouse?: Warehouse;
  channel?: Channel;
}

export interface ForecastData {
  sku_id: string;
  sku_code: string;
  product_name: string;
  option_values: Record<string, string>;
  current_stock: number;
  daily_avg_sales: number;
  days_remaining: number | null; // null = 판매 없음
  reorder_date: string | null;   // 발주 필요일
  reorder_point: number;
  safety_stock: number;
  lead_time_days: number;
  needs_reorder: boolean;
}
