import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getNaverToken, naverFetch } from '@/lib/naver/auth';
import { applyOrdersToInventory } from '@/lib/inventory/applyOrders';
import { buildSkuMatcher } from '@/lib/inventory/matchSku';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { from, to } = await request.json() as { from: string; to: string };
  if (!from || !to) return NextResponse.json({ error: 'from, to 날짜 필요' }, { status: 400 });

  const admin = await createAdminClient();

  // 자격증명 로드
  const { data: cred } = await admin
    .from('naver_credentials')
    .select('client_id, client_secret')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) return NextResponse.json({ error: '네이버 API 키를 먼저 설정하세요' }, { status: 400 });

  const matcher = await buildSkuMatcher(admin);

  let token: string;
  try {
    token = await getNaverToken({ clientId: cred.client_id, clientSecret: cred.client_secret });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  // 날짜 범위를 하루씩 순회 (GET /product-orders 최대 24h 제한)
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate   = new Date(`${to}T23:59:59.999Z`);

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  let cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const dayFrom = cursor.toISOString();
    const dayEnd  = new Date(Math.min(cursor.getTime() + 86400000 - 1, toDate.getTime()));
    const dayTo   = dayEnd.toISOString();

    // Step 1: 해당 날짜 주문 ID 목록 조회 (페이지 반복)
    let page = 1;
    const pageSize = 300;
    const allIds: string[] = [];

    while (true) {
      let listJson: any;
      try {
        listJson = await naverFetch(
          `/external/v1/pay-order/seller/product-orders?from=${encodeURIComponent(dayFrom)}&to=${encodeURIComponent(dayTo)}&page=${page}&pageSize=${pageSize}`,
          token
        );
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }

      const contents: any[] = listJson?.data?.contents ?? [];
      const ids = contents.map((c: any) => c.productOrderId).filter(Boolean);
      allIds.push(...ids);

      if (contents.length < pageSize) break;
      page++;
      await sleep(500);
    }

    // Step 2: 수집된 ID로 상세 조회 (최대 300개씩 배치)
    const BATCH = 300;
    for (let i = 0; i < allIds.length; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH);

      let queryJson: any;
      try {
        queryJson = await naverFetch('/external/v1/pay-order/seller/product-orders/query', token, {
          method: 'POST',
          body: JSON.stringify({ productOrderIds: batch }),
        });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }

      const items: any[] = queryJson?.data ?? [];

      const rows: any[] = items.map((item: any) => {
        const po = item.productOrder ?? {};
        const ord = item.order ?? {};

        // 판매자 설정 상품코드로 SKU 매핑 시도
        const skuCode = po.sellerProductCode ?? po.optionCode ?? '';
        const skuId   = matcher.byCode(skuCode)
                     ?? matcher.byNameOption(po.productName ?? '', po.productOption)
                     ?? null;

        return {
          channel:         'smartstore',
          order_date:      (ord.orderDate ?? po.placeOrderDate ?? from).substring(0, 10),
          order_number:    po.productOrderId ?? null,
          product_name:    po.productName ?? '',
          option_name:     po.productOption ?? null,
          quantity:        Number(po.quantity ?? 1),
          recipient:       po.shippingAddress?.name ?? ord.ordererName ?? null,
          buyer_phone:     ord.ordererTel ?? po.shippingAddress?.tel1 ?? null,
          address:         po.shippingAddress
                             ? `${po.shippingAddress.baseAddress} ${po.shippingAddress.detailedAddress ?? ''}`.trim()
                             : null,
          tracking_number: po.invoiceNo ?? null,
          order_status:    po.productOrderStatus ?? null,
          claim_status:    po.claimStatus ?? null,
          claim_type:      po.claimType ?? null,
          claim_date:      po.claimRequestDate ? po.claimRequestDate.substring(0, 10) : null,
          shipping_cost:   (() => { const addr = po.shippingAddress ? `${po.shippingAddress.baseAddress ?? ''} ${po.shippingAddress.detailedAddress ?? ''}` : ''; const isJeju = /제주|서귀포|울릉|도서산간/.test(addr); return 2650 + (isJeju ? 3000 : 0); })(),
          orig_shipping:   2650,
          jeju_surcharge:  (() => { const addr = po.shippingAddress ? `${po.shippingAddress.baseAddress ?? ''}` : ''; return /제주|서귀포|울릉|도서산간/.test(addr); })(),
          sku_id:          skuId,
        };
      });

      if (rows.length > 0) {
        const { data: inserted, error } = await admin
          .from('channel_orders')
          .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: false })
          .select('id');

        if (error) {
          console.error('naver upsert error:', error.message);
          errors.push(error.message);
          skipped += rows.length;
        } else {
          synced  += inserted?.length ?? 0;
          skipped += rows.length - (inserted?.length ?? 0);
        }
      }
    }

    // 다음 날로 이동 (rate limit 방지)
    await sleep(600);
    cursor = new Date(cursor.getTime() + 86400000);
  }

  // 재고 자동 차감/복구
  let deductResult = null;
  try { deductResult = await applyOrdersToInventory(admin, user.id); } catch {}

  return NextResponse.json({ synced, skipped, errors: errors.length ? errors : undefined, deducted: deductResult?.applied ?? 0, restored: deductResult?.restored ?? 0 });
}
