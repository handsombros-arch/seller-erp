import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';
import { buildSkuMatcher } from '@/lib/inventory/matchSku';
import { applyOrdersToInventory } from '@/lib/inventory/applyOrders';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 전 채널 주문 자동 동기화 (cron용)
 * 최근 3일치 주문을 가져와 upsert (중복 무시)
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const matcher = await buildSkuMatcher(admin);

  const today = new Date().toISOString().slice(0, 10);
  const from3 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const toYmd = (d: string) => d.replace(/-/g, '');
  const nextDayYmd = (d: string) => {
    const dt = new Date(d); dt.setDate(dt.getDate() + 1);
    return dt.toISOString().slice(0, 10).replace(/-/g, '');
  };

  const results: Record<string, any> = {};

  // ─── 1. 쿠팡 그로스 주문 ──────────────────────────────────────────
  try {
    const { data: cred } = await admin
      .from('coupang_credentials')
      .select('access_key, secret_key, vendor_id')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (cred) {
      const credentials = { accessKey: cred.access_key, secretKey: cred.secret_key, vendorId: cred.vendor_id };
      const rgPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${credentials.vendorId}/rg/orders`;
      let rgSynced = 0;

      // 3일간 하루씩
      for (let i = 3; i >= 0; i--) {
        const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        let nextToken: string | undefined;
        do {
          const params: Record<string, string> = { paidDateFrom: toYmd(day), paidDateTo: nextDayYmd(day) };
          if (nextToken) params.nextToken = nextToken;
          const json = await coupangFetch(rgPath, params, credentials);
          const items: any[] = Array.isArray(json?.data) ? json.data : [];
          nextToken = json?.nextToken || undefined;

          const rows = items.flatMap((order: any) => {
            const orderDate = new Date(Number(order.paidAt)).toISOString().slice(0, 10);
            return (order.orderItems ?? []).map((item: any) => {
              const vid = String(item.vendorItemId ?? '');
              return {
                channel: 'coupang_rg', order_date: orderDate,
                order_number: `${order.orderId}-${vid}`,
                product_name: item.productName ?? '', option_name: null,
                quantity: Number(item.salesQuantity ?? 1),
                recipient: null, buyer_phone: null, address: null,
                tracking_number: null, order_status: 'PAID',
                shipping_cost: 0, orig_shipping: 0, jeju_surcharge: false,
                sku_id: matcher.byVendorItemId(vid) ?? matcher.byNameOption(item.productName ?? '') ?? null,
              };
            });
          });

          if (rows.length > 0) {
            const { data: ins } = await admin.from('channel_orders')
              .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: true }).select('id');
            rgSynced += ins?.length ?? 0;
          }
          await sleep(300);
        } while (nextToken);
        await sleep(400);
      }
      results.coupang_rg = { synced: rgSynced };
    } else {
      results.coupang_rg = { skipped: 'no credentials' };
    }
  } catch (err: any) {
    results.coupang_rg = { error: err.message };
  }

  // ─── 2. 네이버 스마트스토어 ───────────────────────────────────────
  try {
    const { data: naverCred } = await admin
      .from('naver_credentials')
      .select('client_id, client_secret')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (naverCred) {
      const { getNaverToken, naverFetch } = await import('@/lib/naver/auth');
      const token = await getNaverToken({ clientId: naverCred.client_id, clientSecret: naverCred.client_secret });
      let naverSynced = 0;

      // 3일간 하루씩
      for (let i = 3; i >= 0; i--) {
        const dayStart = new Date(Date.now() - i * 86400000);
        const dayEnd = new Date(dayStart.getTime() + 86400000 - 1);

        let page = 1;
        const allIds: string[] = [];
        while (true) {
          const listJson = await naverFetch(
            `/external/v1/pay-order/seller/product-orders?from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}&page=${page}&pageSize=300`,
            token
          );
          const ids = (listJson?.data?.contents ?? []).map((c: any) => c.productOrderId).filter(Boolean);
          allIds.push(...ids);
          if ((listJson?.data?.contents ?? []).length < 300) break;
          page++;
          await sleep(500);
        }

        for (let j = 0; j < allIds.length; j += 300) {
          const batch = allIds.slice(j, j + 300);
          const queryJson = await naverFetch('/external/v1/pay-order/seller/product-orders/query', token, {
            method: 'POST', body: JSON.stringify({ productOrderIds: batch }),
          });
          const rows = (queryJson?.data ?? []).map((item: any) => {
            const po = item.productOrder ?? {};
            const ord = item.order ?? {};
            const skuCode = po.sellerProductCode ?? po.optionCode ?? '';
            return {
              channel: 'smartstore',
              order_date: (ord.orderDate ?? po.placeOrderDate ?? from3).substring(0, 10),
              order_number: po.productOrderId ?? null,
              product_name: po.productName ?? '', option_name: po.productOption ?? null,
              quantity: Number(po.quantity ?? 1),
              recipient: po.shippingAddress?.name ?? ord.ordererName ?? null,
              buyer_phone: ord.ordererTel ?? null,
              address: po.shippingAddress ? `${po.shippingAddress.baseAddress} ${po.shippingAddress.detailedAddress ?? ''}`.trim() : null,
              tracking_number: po.invoiceNo ?? null,
              order_status: po.productOrderStatus ?? null,
              claim_status: po.claimStatus ?? null, claim_type: po.claimType ?? null,
              claim_date: po.claimRequestDate ? po.claimRequestDate.substring(0, 10) : null,
              shipping_cost: (() => { const a = po.shippingAddress ? `${po.shippingAddress.baseAddress ?? ''}` : ''; return 2650 + (/제주|서귀포|울릉|도서산간/.test(a) ? 3000 : 0); })(),
              orig_shipping: 2650, jeju_surcharge: (() => { const a = po.shippingAddress ? `${po.shippingAddress.baseAddress ?? ''}` : ''; return /제주|서귀포|울릉|도서산간/.test(a); })(),
              sku_id: matcher.byCode(skuCode) ?? matcher.byNameOption(po.productName ?? '', po.productOption) ?? null,
            };
          });
          if (rows.length > 0) {
            const { data: ins } = await admin.from('channel_orders')
              .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: true }).select('id');
            naverSynced += ins?.length ?? 0;
          }
        }
        await sleep(600);
      }
      results.smartstore = { synced: naverSynced };
    } else {
      results.smartstore = { skipped: 'no credentials' };
    }
  } catch (err: any) {
    results.smartstore = { error: err.message };
  }

  // ─── 3. 토스 ──────────────────────────────────────────────────────
  try {
    const { data: tossCred } = await admin
      .from('toss_credentials')
      .select('access_key, secret_key')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();

    if (tossCred) {
      const { getTossToken, tossFetch } = await import('@/lib/toss/auth');
      const token = await getTossToken({ accessKey: tossCred.access_key, secretKey: tossCred.secret_key });
      let tossSynced = 0;

      let nextCursor: string | null = null;
      do {
        const params = new URLSearchParams({ startDate: from3, endDate: today, limit: '50' });
        if (nextCursor) params.set('nextCursor', nextCursor);
        const json = await tossFetch(`/api/v3/shopping-fep/orders/v2?${params}`, token);
        const items: any[] = json?.success?.results ?? [];
        nextCursor = json?.success?.nextCursor ?? null;

        const rows = items.map((item: any) => {
          const skuCode = item.productManagementCode ?? item.productItemManagementCode ?? '';
          const addr = [item.address, item.detailAddress].filter(Boolean).join(' ').trim();
          return {
            channel: 'toss', order_date: (item.orderedAt ?? from3).substring(0, 10),
            order_number: String(item.orderProductId ?? item.orderId ?? ''),
            product_name: item.productName ?? '', option_name: item.optionName ?? null,
            quantity: Number(item.quantity ?? 1),
            recipient: item.receiverName ?? null, buyer_phone: item.receiverPhone ?? null,
            address: addr || null, tracking_number: item.shippingTrackingNumber ?? null,
            order_status: item.orderProductStatus ?? null,
            claim_date: item.canceledAt ? item.canceledAt.substring(0, 10) : (item.returnedAt ? item.returnedAt.substring(0, 10) : null),
            shipping_cost: 2650 + (/제주|서귀포|울릉|도서산간/.test(addr) ? 3000 : 0),
            orig_shipping: 2650,
            jeju_surcharge: /제주|서귀포|울릉|도서산간/.test(addr),
            sku_id: matcher.byCode(skuCode) ?? matcher.byNameOption(item.productName ?? '', item.optionName) ?? null,
          };
        });

        if (rows.length > 0) {
          const { data: ins } = await admin.from('channel_orders')
            .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: true }).select('id');
          tossSynced += ins?.length ?? 0;
        }
        await sleep(300);
      } while (nextCursor);

      results.toss = { synced: tossSynced };
    } else {
      results.toss = { skipped: 'no credentials' };
    }
  } catch (err: any) {
    results.toss = { error: err.message };
  }

  // ─── 4. 재고 차감/복구 ────────────────────────────────────────────
  try {
    // cron은 system user — userId로 'system' 사용
    const deduct = await applyOrdersToInventory(admin, '00000000-0000-0000-0000-000000000000');
    results.inventory = { deducted: deduct.applied, restored: deduct.restored };
  } catch (err: any) {
    results.inventory = { error: err.message };
  }

  console.log('[cron/sync-orders]', JSON.stringify(results));
  return NextResponse.json({ ok: true, ...results });
}
