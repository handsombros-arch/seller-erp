import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: 가격 정보만 반환 (xlsx 처리는 클라이언트)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 월 고정비용 합산 (항목별 VAT 적용)
  const { data: monthlyCosts } = await admin
    .from('monthly_costs')
    .select('id, amount, vat_applicable, parent_id');
  // parent가 있는 항목(세부)만 합산, parent가 없고 children도 없는 항목도 합산
  const allCosts = monthlyCosts ?? [];
  const parentIds = new Set(allCosts.filter((r: any) => r.parent_id).map((r: any) => r.parent_id));
  const monthlyTotal = allCosts.reduce((s: number, r: any) => {
    // 세부항목이 있는 상위 항목은 건너뜀 (세부항목에서 합산)
    if (!r.parent_id && parentIds.has(r.id)) return s;
    const amt = Number(r.amount ?? 0);
    return s + (r.vat_applicable ? Math.round(amt * 1.1) : amt);
  }, 0);

  // 로켓그로스 세이버 구독 여부
  const { data: coupangCred } = await admin
    .from('coupang_credentials')
    .select('rg_saver_enabled')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rgSaverOn = !!(coupangCred as any)?.rg_saver_enabled;
  const rgSaverMonthly = rgSaverOn ? Math.round(99000 * 1.1) : 0; // VAT 포함

  // 반품 할인율
  const { data: gradeDiscounts } = await admin
    .from('sku_grade_discounts')
    .select('sku_id, grade, rate');
  const discountMap = new Map<string, Record<string, number>>();
  for (const d of gradeDiscounts ?? []) {
    if (!discountMap.has(d.sku_id)) discountMap.set(d.sku_id, {});
    discountMap.get(d.sku_id)![d.grade] = Number(d.rate);
  }

  // 반품 vendorItemId → sku_id + grade 매핑
  const { data: returnItems } = await admin
    .from('rg_return_vendor_items')
    .select('vendor_item_id, grade, sku_id')
    .not('grade', 'is', null)
    .not('sku_id', 'is', null);

  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('platform_sku_id, price, coupon_discount, commission_rate, rg_fee_inout, rg_fee_shipping, rg_fee_return, rg_fee_restock, rg_fee_send, rg_fee_packing, sku:sku_id(id, sku_code, cost_price, product:product_id(name))')
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

  // 반품 vendorItemId에 대한 가격 정보 추가 (신상품가 × 할인율)
  // sku_id → 신상품 platform_sku의 info 매핑
  const skuIdToInfo = new Map<string, { price: number; cost_price: number; product_name: string; sku_code: string; commission_rate: number; rg_cost: number }>();
  for (const ps of platformSkus ?? []) {
    const sku = ps.sku as any;
    if (sku?.id && ps.price != null) {
      const existing = skuIdToInfo.get(sku.id);
      if (!existing) skuIdToInfo.set(sku.id, prices[String(ps.platform_sku_id)] ?? { price: 0, cost_price: 0, product_name: '', sku_code: '', commission_rate: 0, rg_cost: 0 });
    }
  }

  for (const ret of returnItems ?? []) {
    const vid = ret.vendor_item_id;
    if (prices[vid]) continue; // 이미 등록됨
    const baseInfo = skuIdToInfo.get(ret.sku_id);
    if (!baseInfo) continue;
    const discountRates = discountMap.get(ret.sku_id);
    const rate = discountRates?.[ret.grade] ?? 0;
    if (rate <= 0) continue;
    const discountedPrice = Math.round(baseInfo.price * rate / 100);
    prices[vid] = {
      ...baseInfo,
      price: discountedPrice,
    };
  }

  // pricesByName의 키 목록 (클라이언트에서 포함 매칭용)
  return NextResponse.json({ prices, pricesByName, priceNameKeys: Object.keys(pricesByName), rgSaverMonthly, monthlyTotal });
}
