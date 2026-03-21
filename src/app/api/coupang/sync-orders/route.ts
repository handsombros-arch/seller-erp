import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';
import { applyOrdersToInventory } from '@/lib/inventory/applyOrders';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VALID_STATUSES = ['ACCEPT', 'INSTRUCT', 'DELIVERING'];

// yyyymmdd 형식 변환
function toYmd(dateStr: string) {
  return dateStr.replace(/-/g, '');
}

// 다음날 yyyymmdd (RG API paidDateTo는 exclusive)
function nextDayYmd(dateStr: string) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// 날짜 범위를 하루씩 분할 (1000건 하드캡 회피)
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = new Date(from);
  const end = new Date(to);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return days;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { from, to } = await request.json() as { from: string; to: string };
  if (!from || !to) return NextResponse.json({ error: 'from, to 날짜 필요' }, { status: 400 });

  const admin = await createAdminClient();

  const { data: cred } = await admin
    .from('coupang_credentials')
    .select('access_key, secret_key, vendor_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) return NextResponse.json({ error: '쿠팡 API 키를 먼저 설정하세요' }, { status: 400 });

  const credentials = {
    accessKey: cred.access_key,
    secretKey: cred.secret_key,
    vendorId:  cred.vendor_id,
  };

  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [s.sku_code, s.id]));

  // sku_name_aliases: 채널 상품명 → sku_id (주문 매칭 강화)
  const { data: aliasRows } = await admin.from('sku_name_aliases').select('channel_name, sku_id');
  const aliasMap = new Map<string, string>(
    (aliasRows ?? []).map((a: any) => [a.channel_name.trim().toLowerCase(), a.sku_id])
  );

  // 쿠팡그로스 vendorItemId → sku_id 매핑 (신상품 + 반품재판매 옵션ID 모두 포함)
  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('sku_id, platform_sku_id, platform_sku_id_return, channel:channels(type)');
  const rgSkuMap = new Map<string, string>();
  for (const ps of platformSkus ?? []) {
    if ((ps as any).channel?.type !== 'coupang') continue;
    if ((ps as any).platform_sku_id)        rgSkuMap.set(String((ps as any).platform_sku_id),        (ps as any).sku_id);
    if ((ps as any).platform_sku_id_return) rgSkuMap.set(String((ps as any).platform_sku_id_return), (ps as any).sku_id);
  }

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ─── 1. Wing 일반판매 주문 (ordersheets, THIRD_PARTY) ───────────────────────
  const ordersPath = `/v2/providers/openapi/apis/api/v4/vendors/${credentials.vendorId}/ordersheets`;

  for (const status of VALID_STATUSES) {
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = { createdAtFrom: from, createdAtTo: to, status };
      if (nextToken) params.nextToken = nextToken;

      let json: any;
      try {
        json = await coupangFetch(ordersPath, params, credentials);
      } catch (err: any) {
        errors.push(`[Wing/${status}] ${err.message}`);
        break;
      }

      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      nextToken = json?.nextToken || undefined;

      const rows: any[] = [];
      for (const order of items) {
        const orderDate = (order.orderedAt ?? order.paidAt ?? from).substring(0, 10);
        const addr = [order.receiver?.addr1, order.receiver?.addr2].filter(Boolean).join(' ').trim();

        for (const item of order.orderItems ?? []) {
          const skuCode = item.externalVendorSkuCode ?? '';
          rows.push({
            channel:         'coupang',
            order_date:      orderDate,
            order_number:    `${order.shipmentBoxId}-${item.vendorItemId}`,
            product_name:    item.sellerProductName ?? item.vendorItemName ?? '',
            option_name:     item.sellerProductItemName ?? null,
            quantity:        Number(item.shippingCount ?? 1),
            recipient:       order.receiver?.name ?? null,
            buyer_phone:     order.orderer?.safeNumber ?? null,
            address:         addr || null,
            tracking_number: order.invoiceNumber || null,
            order_status:    order.status ?? null,
            shipping_cost:   Number(order.shippingPrice ?? 0) + Number(order.remotePrice ?? 0),
            orig_shipping:   Number(order.shippingPrice ?? 0),
            jeju_surcharge:  order.remoteArea === true,
            sku_id:          skuMap.get(skuCode)
                          ?? aliasMap.get((item.sellerProductName ?? item.vendorItemName ?? '').trim().toLowerCase())
                          ?? null,
          });
        }
      }

      if (rows.length > 0) {
        const { data: inserted, error } = await admin
          .from('channel_orders')
          .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: false })
          .select('id');
        if (error) { errors.push(error.message); skipped += rows.length; }
        else { synced += inserted?.length ?? 0; skipped += rows.length - (inserted?.length ?? 0); }
      }

      await sleep(300);
    } while (nextToken);

    await sleep(300);
  }

  // ─── 2. 로켓그로스 주문 (rg_open_api, 1일 단위 순회 — 1000건 하드캡 회피) ──
  const rgPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${credentials.vendorId}/rg/orders`;
  const days = eachDay(from, to);

  for (const day of days) {
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        paidDateFrom: toYmd(day),
        paidDateTo:   nextDayYmd(day),  // RG API paidDateTo는 exclusive
      };
      if (nextToken) params.nextToken = nextToken;

      let json: any;
      try {
        json = await coupangFetch(rgPath, params, credentials);
      } catch (err: any) {
        errors.push(`[RG/${day}] ${err.message}`);
        break;
      }

      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      nextToken = json?.nextToken || undefined;

      const rows: any[] = [];
      for (const order of items) {
        // paidAt은 Unix ms 타임스탬프
        const orderDate = new Date(Number(order.paidAt)).toISOString().slice(0, 10);

        for (const item of order.orderItems ?? []) {
          const vendorItemId = String(item.vendorItemId ?? '');
          rows.push({
            channel:         'coupang_rg',
            order_date:      orderDate,
            order_number:    `${order.orderId}-${vendorItemId}`,
            product_name:    item.productName ?? '',
            option_name:     null,
            quantity:        Number(item.salesQuantity ?? 1),
            recipient:       null,
            buyer_phone:     null,
            address:         null,
            tracking_number: null,
            order_status:    'PAID',
            shipping_cost:   0,
            orig_shipping:   0,
            jeju_surcharge:  false,
            sku_id:          rgSkuMap.get(vendorItemId)
                          ?? aliasMap.get((item.productName ?? '').trim().toLowerCase())
                          ?? null,
          });
        }
      }

      if (rows.length > 0) {
        const { data: inserted, error } = await admin
          .from('channel_orders')
          .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: false })
          .select('id');
        if (error) { errors.push(error.message); skipped += rows.length; }
        else { synced += inserted?.length ?? 0; skipped += rows.length - (inserted?.length ?? 0); }
      }

      await sleep(300);
    } while (nextToken);

    await sleep(400); // rate limit: 분당 50회
  }

  // 주문 동기화 후 재고 자동 차감/복구
  let deductResult: { applied: number; restored: number; skipped: number; negativeSkuIds: string[] } | null = null;
  try {
    deductResult = await applyOrdersToInventory(admin, user.id);
  } catch {
    // 재고 차감 실패는 주문 동기화 성공에 영향 없음
  }

  return NextResponse.json({
    synced,
    skipped,
    errors: errors.length ? errors : undefined,
    deducted: deductResult?.applied ?? 0,
    restored: deductResult?.restored ?? 0,
  });
}
