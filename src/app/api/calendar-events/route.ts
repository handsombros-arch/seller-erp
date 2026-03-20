import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface CalendarEvent {
  id: string;
  date: string;           // YYYY-MM-DD
  type: 'inbound' | 'outbound' | 'reorder';
  subtype: string;        // 'import' | 'local' | 'coupang_growth' | 'other' | 'reorder'
  label: string;          // 상품명 요약
  quantity: number;
  box_count: number | null;
  supplier: string | null;
  coupang_center: string | null;
  source_id: string;
  po_number?: string | null;
  days_until_stockout?: number;
  sku_code?: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const year  = parseInt(request.nextUrl.searchParams.get('year')  ?? String(new Date().getFullYear()));
  const month = parseInt(request.nextUrl.searchParams.get('month') ?? String(new Date().getMonth() + 1));

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0); // last day of month
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const admin = await createAdminClient();

  const [poRes, outboundCoupangRes, outboundOtherRes, skusRes] = await Promise.all([
    // 입고: PO의 expected_date 기준 (완료 포함 - 완료 시 expected_date = 실제 입고일로 갱신됨)
    admin
      .from('purchase_orders')
      .select(`
        id, po_number, supplier, inbound_type, expected_date, status, total_amount,
        items:purchase_order_items(
          quantity,
          sku:skus(sku_code, product:products(name))
        )
      `)
      .not('expected_date', 'is', null)
      .gte('expected_date', start)
      .lte('expected_date', end)
      .in('status', ['draft', 'ordered', 'transiting', 'partial', 'completed']),

    // 쿠팡그로스 출고: arrival_date 기준
    admin
      .from('outbound_records')
      .select(`
        id, outbound_type, outbound_date, arrival_date, quantity, box_count, coupang_center,
        sku:skus(sku_code, product:products(name))
      `)
      .eq('outbound_type', 'coupang_growth')
      .not('arrival_date', 'is', null)
      .gte('arrival_date', start)
      .lte('arrival_date', end),

    // 기타 출고: outbound_date 기준
    admin
      .from('outbound_records')
      .select(`
        id, outbound_type, outbound_date, arrival_date, quantity, box_count, coupang_center,
        sku:skus(sku_code, product:products(name))
      `)
      .eq('outbound_type', 'other')
      .gte('outbound_date', start)
      .lte('outbound_date', end),

    // 발주 권장일 계산용 SKU 데이터
    admin
      .from('skus')
      .select('id, sku_code, lead_time_days, manual_daily_avg, sales_7d, sales_30d, product:products(name), inventory(quantity)')
      .eq('is_active', true),
  ]);

  const events: CalendarEvent[] = [];

  // 입고 이벤트
  for (const po of (poRes.data ?? [])) {
    const items = (po.items ?? []) as unknown as Array<{ quantity: number; sku: { sku_code: string; product: { name: string } } }>;
    const firstItem = items[0];
    const label = firstItem
      ? `${firstItem.sku?.product?.name ?? firstItem.sku?.sku_code}${items.length > 1 ? ` 외 ${items.length - 1}개` : ''}`
      : '품목 미지정';
    const totalQty = items.reduce((s, i) => s + (i.quantity ?? 0), 0);

    events.push({
      id: `inbound-${po.id}`,
      date: po.expected_date as string,
      type: 'inbound',
      subtype: (po.inbound_type as string) ?? 'import',
      label,
      quantity: totalQty,
      box_count: null,
      supplier: po.supplier,
      coupang_center: null,
      source_id: po.id as string,
      po_number: po.po_number,
    });
  }

  // 출고 이벤트 (쿠팡그로스)
  for (const rec of (outboundCoupangRes.data ?? [])) {
    const sku = rec.sku as unknown as { sku_code: string; product: { name: string } } | null;
    const label = sku?.product?.name ?? sku?.sku_code ?? '미지정';
    events.push({
      id: `outbound-${rec.id}`,
      date: rec.arrival_date as string,
      type: 'outbound',
      subtype: 'coupang_growth',
      label,
      quantity: rec.quantity as number,
      box_count: rec.box_count as number | null,
      supplier: null,
      coupang_center: rec.coupang_center as string | null,
      source_id: rec.id as string,
    });
  }

  // 출고 이벤트 (기타)
  for (const rec of (outboundOtherRes.data ?? [])) {
    const sku = rec.sku as unknown as { sku_code: string; product: { name: string } } | null;
    const label = sku?.product?.name ?? sku?.sku_code ?? '미지정';
    events.push({
      id: `outbound-other-${rec.id}`,
      date: rec.outbound_date as string,
      type: 'outbound',
      subtype: 'other',
      label,
      quantity: rec.quantity as number,
      box_count: null,
      supplier: null,
      coupang_center: null,
      source_id: rec.id as string,
    });
  }

  // 발주 권장일 이벤트
  const today = new Date();
  for (const sku of (skusRes.data ?? [])) {
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
    if (daysUntilReorder < 0) continue;

    const reorderDate = new Date(today);
    reorderDate.setDate(today.getDate() + daysUntilReorder);
    const reorderDateStr = reorderDate.toISOString().slice(0, 10);

    if (reorderDateStr >= start && reorderDateStr <= end) {
      events.push({
        id: `reorder-${s.id}`,
        date: reorderDateStr,
        type: 'reorder',
        subtype: 'reorder',
        label: `${s.product?.name ?? ''} (${s.sku_code}) 발주 권장`,
        quantity: 0,
        box_count: null,
        supplier: null,
        coupang_center: null,
        source_id: s.id,
        sku_code: s.sku_code,
        days_until_stockout: Math.floor(daysRemaining),
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json(events);
}
