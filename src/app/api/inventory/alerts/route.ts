import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 1) 음수 재고 (이론상 없어야 — 이전 버그 흔적 식별용)
  const { data: negativeRows } = await admin
    .from('inventory')
    .select('quantity, sku_id, warehouse_id, sku:skus(sku_code, product:products(name)), warehouse:warehouses(name)')
    .lt('quantity', 0)
    .order('quantity', { ascending: true });

  // 2) 0 으로 floor 된 SKU (현재 재고 0 + 최근 30일 동안 차감/주문 시도 있었음)
  // — 음수 직전에 floor 된 케이스 식별. inventory_adjustments 의 after_quantity = 0 인 행을
  //   같은 sku 의 inventory.quantity = 0 과 매치.
  const since30Iso = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: clampedAdj } = await admin
    .from('inventory_adjustments')
    .select('sku_id, warehouse_id, before_quantity, after_quantity, created_at, reason')
    .eq('after_quantity', 0)
    .gte('created_at', since30Iso)
    .like('reason', '__ORDER__:%')
    .order('created_at', { ascending: false })
    .limit(500);
  // 같은 sku × warehouse 에 대해 가장 최근만 1건씩
  const clampedKey = new Set<string>();
  const clampedRecent: Array<{ sku_id: string; warehouse_id: string; attempted: number; created_at: string }> = [];
  for (const row of clampedAdj ?? []) {
    const k = `${row.sku_id}|${row.warehouse_id}`;
    if (clampedKey.has(k)) continue;
    clampedKey.add(k);
    // attempted = before - after = 차감 시도량 (이번엔 0 으로 floor 돼서 실제 차감은 before 만큼만 됨)
    clampedRecent.push({
      sku_id: row.sku_id as string,
      warehouse_id: row.warehouse_id as string,
      attempted: (row.before_quantity as number) - (row.after_quantity as number),
      created_at: row.created_at as string,
    });
  }
  // sku 정보 join
  const clampedSkuIds = clampedRecent.map((r) => r.sku_id);
  const { data: skuInfoRows } = clampedSkuIds.length
    ? await admin.from('skus').select('id, sku_code, product:products(name)').in('id', clampedSkuIds)
    : { data: [] as any[] };
  const skuInfoMap = new Map<string, { sku_code: string; product_name: string }>();
  for (const r of skuInfoRows ?? []) {
    skuInfoMap.set((r as any).id, {
      sku_code: (r as any).sku_code ?? '',
      product_name: (r as any).product?.name ?? '',
    });
  }
  const clampedToday = clampedRecent.map((r) => ({
    sku_id: r.sku_id,
    sku_code: skuInfoMap.get(r.sku_id)?.sku_code ?? '',
    product_name: skuInfoMap.get(r.sku_id)?.product_name ?? '',
    attempted_deduction: r.attempted,
    created_at: r.created_at,
  }));

  // 3) 미매칭 SKU 주문 (sku_id NULL 인데 channel_orders 에 들어와있음 — 차감 안 됨, 매출 카운트 안 됨)
  const { data: unmappedRows } = await admin
    .from('channel_orders')
    .select('order_number, channel, product_name, option_name, quantity, order_date')
    .is('sku_id', null)
    .gte('order_date', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10))
    .order('order_date', { ascending: false })
    .limit(500);
  // product_name + channel + option_name 으로 dedupe + count
  const unmappedMap = new Map<string, { channel: string; product_name: string; option_name: string | null; count: number; latest_date: string; latest_order_number: string }>();
  for (const r of unmappedRows ?? []) {
    const key = `${r.channel}|${r.product_name ?? ''}|${r.option_name ?? ''}`;
    const prev = unmappedMap.get(key);
    if (prev) {
      prev.count += 1;
      if ((r.order_date as string) > prev.latest_date) {
        prev.latest_date = r.order_date as string;
        prev.latest_order_number = r.order_number as string;
      }
    } else {
      unmappedMap.set(key, {
        channel: r.channel as string,
        product_name: (r.product_name as string) ?? '',
        option_name: (r.option_name as string) ?? null,
        count: 1,
        latest_date: r.order_date as string,
        latest_order_number: r.order_number as string,
      });
    }
  }
  const unmappedOrders = [...unmappedMap.values()].sort((a, b) => b.count - a.count).slice(0, 50);

  return NextResponse.json({
    count: negativeRows?.length ?? 0,
    items: (negativeRows ?? []).map((r: any) => ({
      sku_id: r.sku_id,
      sku_code: r.sku?.sku_code ?? '',
      product_name: r.sku?.product?.name ?? '',
      warehouse_name: r.warehouse?.name ?? '',
      quantity: r.quantity,
    })),
    clamped_today: clampedToday,
    unmapped_orders: unmappedOrders,
  });
}
