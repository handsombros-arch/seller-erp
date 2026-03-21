import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const thu = new Date(d);
  thu.setDate(d.getDate() - day + 4);
  const yearStart = new Date(thu.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thu.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function bucketKey(dateStr: string, unit: string): string {
  if (unit === 'week') return isoWeekKey(dateStr);
  if (unit === 'month') return monthKey(dateStr);
  return dateStr;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit') ?? 'day';
  const days = Number(searchParams.get('days') ?? '90');
  const skuIdsParam = searchParams.get('sku_ids');
  const skuIds = skuIdsParam ? skuIdsParam.split(',').filter(Boolean) : [];

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const admin = await createAdminClient();

  // 1. RG 재고 스냅샷
  let rgQuery = admin
    .from('rg_inventory_snapshots')
    .select('snapshot_date, sku_id, total_orderable_qty')
    .gte('snapshot_date', since)
    .not('sku_id', 'is', null);
  if (skuIds.length) rgQuery = rgQuery.in('sku_id', skuIds);
  const { data: rgRows } = await rgQuery;

  // 2. 창고 재고 (현재값 — 일별 스냅샷 테이블 없음, 현재 수량을 전 기간 기준선으로 사용)
  let whQuery = admin
    .from('inventory')
    .select('sku_id, quantity');
  if (skuIds.length) whQuery = whQuery.in('sku_id', skuIds);
  const { data: whRows } = await whQuery;
  const warehouseTotal = (whRows ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0);

  // 3. 주문 (판매)
  let ordQuery = admin
    .from('channel_orders')
    .select('order_date, sku_id, quantity')
    .gte('order_date', since)
    .not('sku_id', 'is', null);
  if (skuIds.length) ordQuery = ordQuery.in('sku_id', skuIds);
  const { data: ordRows } = await ordQuery;

  // 버킷별 집계
  const buckets = new Map<string, {
    coupang_qty: number; warehouse_qty: number;
    sales_qty: number; order_count: number;
    _rgLatest: string; _whLatest: string;
    _rgByDate: Map<string, number>; _whByDate: Map<string, number>;
  }>();

  function getBucket(key: string) {
    if (!buckets.has(key)) {
      buckets.set(key, {
        coupang_qty: 0, warehouse_qty: 0,
        sales_qty: 0, order_count: 0,
        _rgLatest: '', _whLatest: '',
        _rgByDate: new Map(), _whByDate: new Map(),
      });
    }
    return buckets.get(key)!;
  }

  // RG 재고: 버킷 내 최신 날짜의 합계 사용
  for (const r of rgRows ?? []) {
    const key = bucketKey(r.snapshot_date, unit);
    const b = getBucket(key);
    const dateQty = b._rgByDate.get(r.snapshot_date) ?? 0;
    b._rgByDate.set(r.snapshot_date, dateQty + (r.total_orderable_qty ?? 0));
  }

  // 창고 재고: 현재값을 모든 버킷에 동일하게 적용 (일별 스냅샷 없음)

  // 판매: 합산
  for (const r of ordRows ?? []) {
    const key = bucketKey(r.order_date, unit);
    const b = getBucket(key);
    b.sales_qty += r.quantity ?? 0;
    b.order_count += 1;
  }

  // 버킷 내 최신 날짜의 재고를 대표값으로
  for (const b of buckets.values()) {
    if (b._rgByDate.size > 0) {
      const latestDate = [...b._rgByDate.keys()].sort().at(-1)!;
      b.coupang_qty = b._rgByDate.get(latestDate)!;
    }
    b.warehouse_qty = warehouseTotal;
  }

  // SKU 정보
  const allSkuIds = new Set<string>();
  for (const r of rgRows ?? []) if (r.sku_id) allSkuIds.add(r.sku_id);
  for (const r of whRows ?? []) if (r.sku_id) allSkuIds.add(r.sku_id);
  for (const r of ordRows ?? []) if (r.sku_id) allSkuIds.add(r.sku_id);

  const { data: skuData } = allSkuIds.size > 0
    ? await admin.from('skus').select('id, sku_code, option_values, product:products(name)').in('id', [...allSkuIds])
    : { data: [] };

  const skuInfo: Record<string, { sku_code: string; product_name: string; option_values: Record<string, string> }> = {};
  for (const s of skuData ?? []) {
    skuInfo[s.id] = {
      sku_code: s.sku_code,
      product_name: (s.product as any)?.name ?? '',
      option_values: (s.option_values as Record<string, string>) ?? {},
    };
  }

  // 정렬된 결과
  const sorted = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, b]) => ({
      period,
      coupang_qty: b.coupang_qty,
      warehouse_qty: b.warehouse_qty,
      total_qty: b.coupang_qty + b.warehouse_qty,
      sales_qty: b.sales_qty,
      order_count: b.order_count,
    }));

  return NextResponse.json({ data: sorted, skus: skuInfo });
}
