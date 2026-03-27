import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 가격 정보만 반환 (xlsx 처리는 클라이언트)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 월 고정비용 합산
  const { data: monthlyCosts } = await admin
    .from('monthly_costs')
    .select('amount');
  const monthlyTotal = Math.round(
    (monthlyCosts ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0) * 1.1
  ); // VAT 포함

  // 로켓그로스 세이버 구독 여부
  const { data: coupangCred } = await admin
    .from('coupang_credentials')
    .select('rg_saver_enabled')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rgSaverOn = !!(coupangCred as any)?.rg_saver_enabled;
  const rgSaverMonthly = rgSaverOn ? Math.round(99000 * 1.1) : 0; // VAT 포함

  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('platform_sku_id, price, coupon_discount, commission_rate, rg_fee_inout, rg_fee_shipping, rg_fee_return, rg_fee_restock, rg_fee_send, rg_fee_packing, sku:sku_id(sku_code, cost_price, product:product_id(name))')
    .not('platform_sku_id', 'is', null);

  const prices: Record<string, { price: number; cost_price: number; product_name: string; sku_code: string; commission_rate: number; rg_cost: number }> = {};
  const pricesByName: Record<string, { price: number; cost_price: number; product_name: string; sku_code: string; commission_rate: number; rg_cost: number }> = {};

  for (const ps of platformSkus ?? []) {
    if (ps.platform_sku_id && ps.price != null) {
      const sku = ps.sku as any;
      const couponDiscount = Number((ps as any).coupon_discount ?? 0);
      const rgCostExVat = Number((ps as any).rg_fee_inout ?? 0) + Number((ps as any).rg_fee_shipping ?? 0) // 입출고배송비
        + (rgSaverOn ? 0 : Number((ps as any).rg_fee_return ?? 0))
        + (rgSaverOn ? 0 : Number((ps as any).rg_fee_restock ?? 0))
        + Number((ps as any).rg_fee_send ?? 0)
        + Number((ps as any).rg_fee_packing ?? 0);
      const rgCost = Math.round(rgCostExVat * 1.1); // VAT 포함
      const info = {
        price: Number(ps.price) - couponDiscount,
        cost_price: Number(sku?.cost_price ?? 0),
        product_name: sku?.product?.name ?? '',
        sku_code: sku?.sku_code ?? '',
        commission_rate: Number((ps as any).commission_rate ?? 0),
        rg_cost: rgCost,
      };
      prices[String(ps.platform_sku_id)] = info;

      // platform_product_name 키로도 저장 (소문자, 공백 정규화)
      const pName = ((ps as any).platform_product_name ?? '').trim().toLowerCase();
      if (pName && !pricesByName[pName]) {
        pricesByName[pName] = info;
      }
    }
  }

  // pricesByName의 키 목록 (클라이언트에서 포함 매칭용)
  return NextResponse.json({ prices, pricesByName, priceNameKeys: Object.keys(pricesByName), rgSaverMonthly, monthlyTotal });
}
