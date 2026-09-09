import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/settlement/crosscheck?year_month=YYYY-MM
 * 시트 수기 입력을 대조할 기준값. 출처별로 표시:
 *  - API: 채널 주문 동기화(channel_orders, 쿠팡/토스/네이버 API) × 마스터 단가·수수료·건당 요금
 *  - 파일: 매출 파일 업로드(monthly_product_sales) / 광고 raw 집계(monthly_product_ads)
 *  - 설정: 세이버 구독 등
 * 반환 refs[key] = { value, source, detail }
 */
export interface Ref { value: number; source: 'API' | '파일' | '설정'; detail: string }

const CANCEL = /CANCEL|취소|REFUND|RETURN_COMPLETED/i;
const MARKET_OF_CHANNEL: Record<string, string> = { coupang_rg: 'coupang', coupang: 'coupang', toss: 'toss', smartstore: 'smartstore', naver: 'smartstore', esm: 'esm', gmarket: 'esm', auction: 'esm', talkdeal: 'talkdeal' };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const ym = request.nextUrl.searchParams.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month 필요' }, { status: 400 });
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`, to = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const admin = await createAdminClient();
  const [ordersRes, psRes, skusRes, salesRes, adsRes, credRes] = await Promise.all([
    fetchAll((f, t) => admin.from('channel_orders').select('channel, quantity, shipping_cost, order_status, claim_type, sku_id, is_dummy').gte('order_date', from).lte('order_date', to).range(f, t)),
    admin.from('platform_skus').select('sku_id, price, coupon_discount, commission_rate, rg_fee_inout, rg_fee_shipping, rg_fee_return, rg_fee_restock, rg_fee_send, rg_fee_packing, channel:channels(type)'),
    admin.from('skus').select('id, cost_price'),
    admin.from('monthly_product_sales').select('platform, qty, revenue, total_cost, empty_qty').eq('user_id', user.id).eq('year_month', ym),
    admin.from('monthly_product_ads').select('platform, cost').eq('user_id', user.id).eq('year_month', ym),
    admin.from('coupang_credentials').select('rg_saver_enabled').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const orders = ordersRes.filter((o: any) => !o.is_dummy && !CANCEL.test(String(o.order_status ?? '')) && !CANCEL.test(String(o.claim_type ?? '')));
  const ps = new Map<string, any>();
  for (const p of psRes.data ?? []) { const t = (p as any).channel?.type; if (t) ps.set(`${t}|${p.sku_id}`, p); }
  const cost = new Map((skusRes.data ?? []).map((s: any) => [s.id, Number(s.cost_price) || 0]));

  // 마켓별 API 집계
  type Acc = { orders: number; qty: number; matchedQty: number; revenue: number; coupon: number; cogs: number; commission: number; inout: number; send: number; packing: number; shipping: number; shipCost: number };
  const mk = new Map<string, Acc>();
  const acc = (k: string) => { let a = mk.get(k); if (!a) { a = { orders: 0, qty: 0, matchedQty: 0, revenue: 0, coupon: 0, cogs: 0, commission: 0, inout: 0, send: 0, packing: 0, shipping: 0, shipCost: 0 }; mk.set(k, a); } return a; };
  for (const o of orders as any[]) {
    const market = MARKET_OF_CHANNEL[String(o.channel)] ?? 'other';
    const a = acc(market);
    const qty = Number(o.quantity) || 0;
    a.orders += 1; a.qty += qty; a.shipCost += Number(o.shipping_cost) || 0;
    const p = o.sku_id ? ps.get(`${market}|${o.sku_id}`) : null;
    if (p && Number(p.price) > 0) {
      a.matchedQty += qty;
      const price = Number(p.price);
      a.revenue += price * qty;
      a.coupon += (Number(p.coupon_discount) || 0) * qty;
      a.commission += price * qty * ((Number(p.commission_rate) || 0) / 100);
      a.inout += (Number(p.rg_fee_inout) || 0) * qty;
      a.send += (Number(p.rg_fee_send) || 0) * qty;
      a.packing += (Number(p.rg_fee_packing) || 0) * qty;
      a.shipping += (Number(p.rg_fee_shipping) || 0) * qty;
    }
    if (o.sku_id && cost.has(o.sku_id)) a.cogs += cost.get(o.sku_id)! * qty;
  }

  const refs: Record<string, Ref> = {};
  const put = (key: string, value: number, source: Ref['source'], detail: string) => { if (value > 0) refs[key] = { value: Math.round(value), source, detail }; };

  for (const [market, a] of mk) {
    if (market === 'other') continue;
    const cov = a.qty ? `${a.matchedQty}/${a.qty}개 단가 매칭` : '';
    put(`revenue:${market}`, a.revenue, 'API', `주문 ${a.orders}건 × 마스터 판매가 (${cov}, 쿠폰 차감 전)`);
    put(`coupon:${market}`, a.coupon, 'API', `주문 수량 × 마스터 쿠폰`);
    put(`cogs:${market}`, a.cogs, 'API', `주문 수량 ${a.qty}개 × SKU 원가`);
    put(`commission:${market}`, a.commission, 'API', `판매가 × 상품별 수수료율`);
    if (market === 'coupang') {
      put('rg_inout:coupang', a.inout, 'API', `수량 ${a.qty}개 × 입출고비(건당)`);
      put('rg_send:coupang', a.send, 'API', `수량 × 창고발송 배송비(건당)`);
      put('rg_packing:coupang', a.packing, 'API', `수량 × 포장·바코드(건당)`);
      put('rg_shipping:coupang', a.shipping, 'API', `수량 × 배송비(건당)`);
    }
  }
  // 자사 출고 택배비 (쿠팡 RG 제외)
  const small = [...mk.entries()].filter(([k]) => k !== 'coupang' && k !== 'other').reduce((s, [, a]) => s + a.shipCost, 0);
  const smallOrders = [...mk.entries()].filter(([k]) => k !== 'coupang' && k !== 'other').reduce((s, [, a]) => s + a.orders, 0);
  put('shipping_small', small, 'API', `자사 출고 ${smallOrders}건 × 운임(2,650 + 도서산간 3,000)`);

  // 파일 기반
  const sales = new Map<string, { qty: number; revenue: number; cost: number; emptyQty: number; emptyRefund: number }>();
  for (const r of (salesRes.data ?? []) as any[]) {
    const s = sales.get(r.platform) ?? { qty: 0, revenue: 0, cost: 0, emptyQty: 0, emptyRefund: 0 };
    const qty = Number(r.qty) || 0, rev = Number(r.revenue) || 0, eq = Number(r.empty_qty) || 0;
    s.qty += qty; s.revenue += rev; s.cost += Number(r.total_cost) || 0;
    if (eq > 0 && qty > 0) { s.emptyQty += eq; s.emptyRefund += (rev / qty) * eq; }
    sales.set(r.platform, s);
  }
  for (const [platform, s] of sales) {
    put(`revenue_file:${platform}`, s.revenue, '파일', `매출 파일 ${s.qty}개 실거래 금액`);
    put(`cogs_file:${platform}`, s.cost, '파일', `매출 파일 수량 × 적용 원가`);
    put(`emptybox:${platform}`, s.emptyRefund, '파일', `빈박스 ${s.emptyQty}개 × 판매가 (환불 추정)`);
  }
  const adCoupang = (adsRes.data ?? []).filter((r: any) => r.platform === 'coupang').reduce((s: number, r: any) => s + (Number(r.cost) || 0), 0);
  put('ad:coupang', adCoupang * 1.1, '파일', `광고 raw 월 집계 ${Math.round(adCoupang).toLocaleString('ko-KR')} × 1.1 (보고서는 VAT 별도)`);

  // 설정
  if ((credRes.data as any)?.rg_saver_enabled) put('saver:coupang', Math.round(99000 * 1.1), '설정', '그로스 세이버 99,000 × 1.1');

  return NextResponse.json({ yearMonth: ym, refs, orders: Object.fromEntries([...mk.entries()].map(([k, a]) => [k, { orders: a.orders, qty: a.qty }])) });
}

async function fetchAll(q: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const out: any[] = []; const PAGE = 1000;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await q(i * PAGE, i * PAGE + PAGE - 1);
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
