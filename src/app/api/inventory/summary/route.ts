import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface InventorySummaryRow {
  sku_id: string;
  sku_code: string;
  product_name: string;
  option_values: Record<string, string>;
  cost_price: number;
  safety_stock: number;
  sales_30d: number;
  sales_7d: number;
  warehouse_stock: number;   // 자사창고 합계
  coupang_stock: number;     // 쿠팡그로스 출고 - 쿠팡직접 판매
  transit_stock: number;     // 발주 중 (ordered/transiting)
  total_stock: number;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 1. SKU list with settings
  const { data: skus } = await admin
    .from('skus')
    .select('id, sku_code, option_values, cost_price, safety_stock, sales_30d, sales_7d, product:products(name)')
    .eq('is_active', true);

  if (!skus?.length) return NextResponse.json([]);

  // 2. Warehouse stock (창고 타입별 분리)
  const { data: invItems } = await admin
    .from('inventory')
    .select('sku_id, quantity, warehouse:warehouses(type)');

  // 3. 실제 channel_orders 판매량 집계 (sku_id 매칭된 것만)
  const now = new Date();
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d7  = new Date(now); d7.setDate(d7.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const { data: orders30 } = await admin
    .from('channel_orders')
    .select('sku_id, quantity')
    .not('sku_id', 'is', null)
    .gte('order_date', fmt(d30));

  const { data: orders7 } = await admin
    .from('channel_orders')
    .select('sku_id, quantity')
    .not('sku_id', 'is', null)
    .gte('order_date', fmt(d7));

  const orders30Map = new Map<string, number>();
  for (const o of orders30 ?? []) {
    if (o.sku_id) orders30Map.set(o.sku_id, (orders30Map.get(o.sku_id) ?? 0) + o.quantity);
  }
  const orders7Map = new Map<string, number>();
  for (const o of orders7 ?? []) {
    if (o.sku_id) orders7Map.set(o.sku_id, (orders7Map.get(o.sku_id) ?? 0) + o.quantity);
  }

  // 4. In-transit PO items
  // Get in-transit PO IDs first
  const { data: transitPOs } = await admin
    .from('purchase_orders')
    .select('id')
    .in('status', ['ordered', 'transiting']);

  const transitPoIds = (transitPOs ?? []).map((p) => p.id);

  const { data: poItems } = transitPoIds.length
    ? await admin
        .from('purchase_order_items')
        .select('sku_id, quantity, received_quantity')
        .in('po_id', transitPoIds)
    : { data: [] };

  // 최신 RG 재고 스냅샷 (sku_id 기준 가장 최근 1건)
  const { data: rgSnaps } = await admin
    .from('rg_inventory_snapshots')
    .select('sku_id, total_orderable_qty')
    .not('sku_id', 'is', null)
    .order('snapshot_date', { ascending: false });
  const rgMap = new Map<string, number>();
  for (const snap of rgSnaps ?? []) {
    if (snap.sku_id && !rgMap.has(snap.sku_id)) rgMap.set(snap.sku_id, snap.total_orderable_qty);
  }

  // Build maps (자사창고: own/3pl/other, 쿠팡창고: coupang 분리)
  const warehouseMap = new Map<string, number>();
  const coupangWHMap = new Map<string, number>();
  for (const i of invItems ?? []) {
    const whType = (i.warehouse as any)?.type;
    if (whType === 'coupang') {
      coupangWHMap.set(i.sku_id, (coupangWHMap.get(i.sku_id) ?? 0) + i.quantity);
    } else {
      warehouseMap.set(i.sku_id, (warehouseMap.get(i.sku_id) ?? 0) + i.quantity);
    }
  }

  const transitMap = new Map<string, number>();
  for (const i of poItems ?? []) {
    const remaining = i.quantity - (i.received_quantity ?? 0);
    if (remaining > 0) transitMap.set(i.sku_id, (transitMap.get(i.sku_id) ?? 0) + remaining);
  }

  const summary: InventorySummaryRow[] = skus.map((sku) => {
    const warehouse_stock = warehouseMap.get(sku.id) ?? 0;
    // RG 스냅샷 우선, 없으면 쿠팡 타입 창고 재고 사용
    const coupang_stock = rgMap.has(sku.id) ? (rgMap.get(sku.id) ?? 0) : (coupangWHMap.get(sku.id) ?? 0);
    const transit_stock = transitMap.get(sku.id) ?? 0;
    // channel_orders 실제 판매 우선, 없으면 수동 입력값
    const sales_30d = orders30Map.has(sku.id) ? (orders30Map.get(sku.id) ?? 0) : (sku.sales_30d ?? 0);
    const sales_7d  = orders7Map.has(sku.id)  ? (orders7Map.get(sku.id)  ?? 0) : (sku.sales_7d  ?? 0);

    return {
      sku_id: sku.id,
      sku_code: sku.sku_code,
      product_name: (sku.product as any)?.name ?? '',
      option_values: sku.option_values ?? {},
      cost_price: sku.cost_price ?? 0,
      safety_stock: sku.safety_stock ?? 0,
      sales_30d,
      sales_7d,
      warehouse_stock,
      coupang_stock,
      transit_stock,
      total_stock: warehouse_stock + coupang_stock + transit_stock,
    };
  });

  return NextResponse.json(summary);
}
