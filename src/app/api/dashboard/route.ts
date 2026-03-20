import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const sevenDaysAgo  = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
  const fourteenDaysAgo = new Date(today); fourteenDaysAgo.setDate(today.getDate() - 14);
  const twoWeeks = new Date(today); twoWeeks.setDate(today.getDate() + 14);
  const twoWeeksStr = twoWeeks.toISOString().slice(0, 10);

  const [
    { data: inventory },
    { data: skus },
    { data: monthlyOutbound },
    { data: pendingPOs },
    { data: recentInbound },
    { data: outbound7d },
    { data: outboundPrev7d },
    { data: latestSnapshotRow },
    { data: upcomingPOs },
  ] = await Promise.all([
    admin.from('inventory').select('quantity, sku:skus(sku_code, cost_price, product:products(name))'),
    admin.from('skus').select('id, sku_code, reorder_point, safety_stock, lead_time_days, cost_price, option_values, manual_daily_avg, sales_7d, sales_30d, product:products(name), inventory(quantity, warehouse:warehouses(name))').eq('is_active', true),
    admin.from('outbound_records').select('quantity, channel:channels(name, type)').gte('outbound_date', startOfMonth.toISOString().slice(0, 10)),
    admin.from('purchase_orders').select('id, po_number, supplier, status, expected_date, total_amount').in('status', ['ordered', 'partial']).order('expected_date', { ascending: true }).limit(5),
    admin.from('inbound_records').select('id, quantity, inbound_date, sku:skus(sku_code, product:products(name)), warehouse:warehouses(name)').order('created_at', { ascending: false }).limit(5),
    admin.from('outbound_records').select('sku_id, quantity, sku:skus(sku_code, product:products(name))').gte('outbound_date', sevenDaysAgo.toISOString().slice(0, 10)),
    admin.from('outbound_records').select('sku_id, quantity').gte('outbound_date', fourteenDaysAgo.toISOString().slice(0, 10)).lt('outbound_date', sevenDaysAgo.toISOString().slice(0, 10)),
    admin.from('rg_inventory_snapshots').select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('purchase_orders').select('id, po_number, supplier, expected_date, items:purchase_order_items(quantity, sku:skus(sku_code, product:products(name)))').in('status', ['ordered', 'partial', 'transiting']).gte('expected_date', todayStr).lte('expected_date', twoWeeksStr).order('expected_date', { ascending: true }).limit(8),
  ]);

  // ── 쿠팡 최신 재고 ──────────────────────────────────────────────────────────
  const latestDate = (latestSnapshotRow as any)?.snapshot_date ?? null;
  const { data: coupangSnaps } = latestDate
    ? await admin.from('rg_inventory_snapshots').select('sku_id, total_orderable_qty').eq('snapshot_date', latestDate)
    : { data: [] };
  const coupangBySkuId: Record<string, number> = {};
  for (const s of coupangSnaps ?? []) {
    if ((s as any).sku_id) coupangBySkuId[(s as any).sku_id] = (s as any).total_orderable_qty ?? 0;
  }
  const totalCoupangStock = Object.values(coupangBySkuId).reduce((a, b) => a + b, 0);

  // ── 이상 감지 (7일 vs 이전 7일) ─────────────────────────────────────────────
  const recent7dBySku: Record<string, { qty: number; sku_code: string; product_name: string }> = {};
  for (const o of outbound7d ?? []) {
    const s = o as any;
    if (!recent7dBySku[s.sku_id]) recent7dBySku[s.sku_id] = { qty: 0, sku_code: s.sku?.sku_code ?? '', product_name: s.sku?.product?.name ?? '' };
    recent7dBySku[s.sku_id].qty += s.quantity;
  }
  const prev7dBySku: Record<string, number> = {};
  for (const o of outboundPrev7d ?? []) {
    const s = o as any;
    prev7dBySku[s.sku_id] = (prev7dBySku[s.sku_id] ?? 0) + s.quantity;
  }
  const anomalies = Object.entries(recent7dBySku)
    .filter(([id, { qty }]) => {
      const prev = prev7dBySku[id] ?? 0;
      return qty >= 10 && (prev === 0 ? qty >= 20 : qty >= prev * 1.8);
    })
    .map(([id, { qty, sku_code, product_name }]) => ({
      sku_id: id, sku_code, product_name,
      recent_7d: qty,
      prev_7d: prev7dBySku[id] ?? 0,
      change_pct: prev7dBySku[id] ? Math.round(((qty / prev7dBySku[id]) - 1) * 100) : null,
    }))
    .sort((a, b) => b.recent_7d - a.recent_7d)
    .slice(0, 5);

  // ── 다가오는 발주 권장일 (14일 이내) ─────────────────────────────────────────
  const upcomingReorders: Array<{ type: 'reorder'; date: string; label: string; days_until: number; days_until_stockout: number }> = [];
  for (const sku of skus ?? []) {
    const s = sku as any;
    const currentStock = (s.inventory ?? []).reduce((sum: number, i: any) => sum + (i.quantity ?? 0), 0);
    const s7d = s.sales_7d ?? 0;
    const s30d = s.sales_30d ?? 0;
    let dailyAvg = 0;
    if (s7d > 0) dailyAvg = s7d / 7;
    else if (s30d > 0) dailyAvg = s30d / 30;
    else if (s.manual_daily_avg) dailyAvg = s.manual_daily_avg;
    if (dailyAvg <= 0) continue;

    const daysRemaining = currentStock / dailyAvg;
    const daysUntilReorder = Math.floor(daysRemaining - (s.lead_time_days ?? 0));
    if (daysUntilReorder < 0 || daysUntilReorder > 14) continue;

    const reorderDate = new Date(today);
    reorderDate.setDate(today.getDate() + daysUntilReorder);
    upcomingReorders.push({
      type: 'reorder',
      date: reorderDate.toISOString().slice(0, 10),
      label: `${s.product?.name ?? ''} (${s.sku_code})`,
      days_until: daysUntilReorder,
      days_until_stockout: Math.floor(daysRemaining),
    });
  }

  // ── 다가오는 예정 (입고 + 발주 권장) ─────────────────────────────────────────
  const upcomingEvents = [
    ...(upcomingPOs ?? []).map((po: any) => {
      const items = po.items ?? [];
      const first = items[0];
      const daysUntil = Math.ceil((new Date(po.expected_date).getTime() - today.getTime()) / 86400000);
      return {
        type: 'inbound' as const,
        date: po.expected_date as string,
        label: first
          ? `${first.sku?.product?.name ?? first.sku?.sku_code ?? '품목'}${items.length > 1 ? ` 외 ${items.length - 1}건` : ''}`
          : po.po_number ?? '발주',
        po_number: po.po_number as string,
        days_until: Math.max(0, daysUntil),
      };
    }),
    ...upcomingReorders,
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);

  // ── 기존 집계 ──────────────────────────────────────────────────────────────
  const totalSkus = (skus ?? []).length;
  const totalStock = (inventory ?? []).reduce((s, i) => s + ((i as any).quantity ?? 0), 0);
  const totalStockValue = (inventory ?? []).reduce((s, i: any) => s + (i.quantity ?? 0) * (i.sku?.cost_price ?? 0), 0);
  const needsReorder = (skus ?? []).filter((sku: any) => {
    const total = (sku.inventory ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
    return total <= sku.reorder_point;
  });
  const channelSales: Record<string, number> = {};
  for (const o of monthlyOutbound ?? []) {
    const ch = (o as any).channel?.name ?? '기타';
    channelSales[ch] = (channelSales[ch] ?? 0) + ((o as any).quantity ?? 0);
  }

  // ── 창고 재고 스냅샷 (오늘 날짜로 upsert, 비동기로 처리하여 응답 지연 없음) ──────
  const inventoryForSnapshot = await admin.from('inventory').select('sku_id, warehouse_id, quantity');
  if (inventoryForSnapshot.data && inventoryForSnapshot.data.length > 0) {
    const snapRows = inventoryForSnapshot.data.map((row) => ({
      snapshot_date: todayStr,
      sku_id:        row.sku_id,
      warehouse_id:  row.warehouse_id,
      quantity:      row.quantity,
    }));
    // fire-and-forget: await 없이 실행 (에러 무시)
    admin.from('inventory_snapshots')
      .upsert(snapRows, { onConflict: 'snapshot_date,sku_id,warehouse_id', ignoreDuplicates: true })
      .then(() => {}).catch(() => {});
  }

  return NextResponse.json({
    stats: { totalSkus, totalStock, totalStockValue, needsReorderCount: needsReorder.length, coupangStock: totalCoupangStock, coupangStockDate: latestDate },
    needsReorder: needsReorder.slice(0, 5),
    pendingPOs: pendingPOs ?? [],
    recentInbound: recentInbound ?? [],
    channelSales,
    upcomingEvents,
    anomalies,
  });
}
