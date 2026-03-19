import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [{ data: skus }, { data: outbounds }] = await Promise.all([
    admin
      .from('skus')
      .select('*, product:products(name), inventory(quantity, warehouse:warehouses(name, id))')
      .eq('is_active', true),
    admin
      .from('outbound_records')
      .select('sku_id, quantity')
      .gte('outbound_date', thirtyDaysAgo.toISOString().split('T')[0]),
  ]);

  const outboundBySkuId: Record<string, number> = {};
  (outbounds ?? []).forEach((o: any) => {
    outboundBySkuId[o.sku_id] = (outboundBySkuId[o.sku_id] ?? 0) + o.quantity;
  });

  const forecast = (skus ?? []).map((sku: any) => {
    const currentStock = (sku.inventory ?? []).reduce(
      (s: number, i: any) => s + (i.quantity ?? 0),
      0
    );

    const s7d  = sku.sales_7d  ?? 0;
    const s30d = sku.sales_30d ?? 0;
    const outbound30d = outboundBySkuId[sku.id] ?? 0;

    // 일평균 우선순위: 7일 쿠팡 실판매 → 30일 쿠팡 실판매 → 출고 기록 → 수동 입력
    let dailyAvg = 0;
    let salesSource = 'none';

    if (s7d > 0) {
      dailyAvg = s7d / 7;
      salesSource = 'coupang_7d';
    } else if (s30d > 0) {
      dailyAvg = s30d / 30;
      salesSource = 'coupang_30d';
    } else if (outbound30d > 0) {
      dailyAvg = outbound30d / 30;
      salesSource = 'outbound';
    } else if (sku.manual_daily_avg) {
      dailyAvg = sku.manual_daily_avg;
      salesSource = 'manual';
    }

    const daysRemaining = dailyAvg > 0 ? Math.floor(currentStock / dailyAvg) : null;

    let reorderDate: string | null = null;
    if (daysRemaining !== null) {
      const d = new Date();
      d.setDate(d.getDate() + daysRemaining - sku.lead_time_days);
      reorderDate = d.toISOString().split('T')[0];
    }

    const needsReorder =
      currentStock <= sku.reorder_point ||
      (daysRemaining !== null && daysRemaining <= sku.lead_time_days);

    return {
      sku_id:          sku.id,
      sku_code:        sku.sku_code,
      product_name:    sku.product?.name ?? '',
      option_values:   sku.option_values ?? {},
      current_stock:   currentStock,
      daily_avg_sales: Math.round(dailyAvg * 10) / 10,
      daily_avg_7d:    s7d > 0 ? Math.round((s7d / 7) * 10) / 10 : null,
      daily_avg_30d:   s30d > 0 ? Math.round((s30d / 30) * 10) / 10 : null,
      sales_7d:        s7d,
      sales_30d:       s30d,
      sales_source:    salesSource,
      days_remaining:  daysRemaining,
      reorder_date:    reorderDate,
      reorder_point:   sku.reorder_point,
      safety_stock:    sku.safety_stock,
      lead_time_days:  sku.lead_time_days,
      needs_reorder:   needsReorder,
      cost_price:      sku.cost_price,
      stock_value:     currentStock * sku.cost_price,
    };
  });

  forecast.sort((a: any, b: any) => {
    if (a.needs_reorder !== b.needs_reorder) return a.needs_reorder ? -1 : 1;
    if (a.days_remaining === null) return 1;
    if (b.days_remaining === null) return -1;
    return a.days_remaining - b.days_remaining;
  });

  return NextResponse.json(forecast);
}
