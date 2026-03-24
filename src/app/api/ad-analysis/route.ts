import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 가격 정보만 반환 (xlsx 처리는 클라이언트)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('platform_sku_id, price, commission_rate, sku:sku_id(sku_code, cost_price, product:product_id(name))')
    .not('platform_sku_id', 'is', null);

  const prices: Record<string, { price: number; cost_price: number; product_name: string; sku_code: string; commission_rate: number }> = {};
  for (const ps of platformSkus ?? []) {
    if (ps.platform_sku_id && ps.price != null) {
      const sku = ps.sku as any;
      prices[String(ps.platform_sku_id)] = {
        price: Number(ps.price),
        cost_price: Number(sku?.cost_price ?? 0),
        product_name: sku?.product?.name ?? '',
        sku_code: sku?.sku_code ?? '',
        commission_rate: Number((ps as any).commission_rate ?? 0),
      };
    }
  }

  return NextResponse.json({ prices });
}
