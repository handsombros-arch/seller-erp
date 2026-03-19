import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

function getWeekBucket(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  // ISO week: Monday-based
  const day = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon..7=Sun
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 4);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const unit = searchParams.get('unit') ?? 'day';
  const skuIdsParam = searchParams.get('sku_ids');
  const skuIds = skuIdsParam ? skuIdsParam.split(',').filter(Boolean) : [];

  const admin = await createAdminClient();

  let query = admin
    .from('channel_sales')
    .select('sale_date, sku_id, quantity')
    .not('sku_id', 'is', null);

  if (from) query = query.gte('sale_date', from);
  if (to) query = query.lte('sale_date', to);
  if (skuIds.length) query = query.in('sku_id', skuIds);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Group by bucket + sku_id
  const grouped: Record<string, Record<string, number>> = {};
  for (const row of data ?? []) {
    const bucket = unit === 'week' ? getWeekBucket(row.sale_date as string) : (row.sale_date as string);
    const sid = row.sku_id as string;
    if (!grouped[bucket]) grouped[bucket] = {};
    grouped[bucket][sid] = (grouped[bucket][sid] ?? 0) + (row.quantity as number);
  }

  // Get SKU info
  const foundSkuIds = [...new Set((data ?? []).map((r) => r.sku_id).filter(Boolean))] as string[];
  const { data: skuData } = foundSkuIds.length
    ? await admin.from('skus').select('id, sku_code, option_values, product:products(name)').in('id', foundSkuIds)
    : { data: [] };

  const skuInfo: Record<string, { sku_code: string; product_name: string; option_values: Record<string, string> }> = {};
  for (const s of skuData ?? []) {
    skuInfo[s.id] = {
      sku_code: s.sku_code,
      product_name: (s.product as any)?.name ?? '',
      option_values: (s.option_values as Record<string, string>) ?? {},
    };
  }

  const sorted = Object.keys(grouped).sort();
  const chartData = sorted.map((date) => ({ date, ...grouped[date] }));

  return NextResponse.json({ data: chartData, skus: skuInfo });
}
