import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 전체 재고 (창고별)
  const { data: inventory } = await admin
    .from('inventory')
    .select('quantity, warehouse:warehouses(name), sku:skus(sku_code, cost_price, product:products(name))');

  // 발주 필요 SKU (재고 ≤ reorder_point)
  const { data: lowStockSkus } = await admin
    .from('skus')
    .select('id, sku_code, reorder_point, safety_stock, lead_time_days, cost_price, option_values, product:products(name), inventory(quantity, warehouse:warehouses(name))')
    .eq('is_active', true);

  // 이번 달 출고 (채널별)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthlyOutbound } = await admin
    .from('outbound_records')
    .select('quantity, unit_price, channel:channels(name, type)')
    .gte('outbound_date', startOfMonth.toISOString().split('T')[0]);

  // 진행 중 발주서
  const { data: pendingPOs } = await admin
    .from('purchase_orders')
    .select('id, po_number, supplier, status, expected_date, total_amount')
    .in('status', ['ordered', 'partial'])
    .order('expected_date', { ascending: true })
    .limit(5);

  // 최근 입출고
  const { data: recentInbound } = await admin
    .from('inbound_records')
    .select('id, quantity, inbound_date, sku:skus(sku_code, product:products(name)), warehouse:warehouses(name)')
    .order('created_at', { ascending: false })
    .limit(5);

  // 집계
  const totalSkus = (lowStockSkus ?? []).length;
  const totalStock = (inventory ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);
  const totalStockValue = (inventory ?? []).reduce((s, i: any) => {
    return s + (i.quantity ?? 0) * (i.sku?.cost_price ?? 0);
  }, 0);

  const needsReorder = (lowStockSkus ?? []).filter((sku: any) => {
    const total = (sku.inventory ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
    return total <= sku.reorder_point;
  });

  const channelSales: Record<string, number> = {};
  (monthlyOutbound ?? []).forEach((o: any) => {
    const ch = o.channel?.name ?? '기타';
    channelSales[ch] = (channelSales[ch] ?? 0) + (o.quantity ?? 0);
  });

  return NextResponse.json({
    stats: {
      totalSkus,
      totalStock,
      totalStockValue,
      needsReorderCount: needsReorder.length,
    },
    needsReorder: needsReorder.slice(0, 5),
    pendingPOs: pendingPOs ?? [],
    recentInbound: recentInbound ?? [],
    channelSales,
  });
}
