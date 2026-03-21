import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getTossToken, tossFetch } from '@/lib/toss/auth';
import { applyOrdersToInventory } from '@/lib/inventory/applyOrders';

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
    .from('toss_credentials')
    .select('access_key, secret_key')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) return NextResponse.json({ error: '토스 API 키를 먼저 설정하세요' }, { status: 400 });

  // SKU 코드 맵
  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [s.sku_code, s.id]));

  let token: string;
  try {
    token = await getTossToken({ accessKey: cred.access_key, secretKey: cred.secret_key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  // 최대 31일 제한 → 필요시 분할 (단순화를 위해 한 번에 조회)
  let nextCursor: string | null = null;

  do {
    const params = new URLSearchParams({
      startDate: from,
      endDate:   to,
      limit:     '50',
    });
    if (nextCursor) params.set('nextCursor', nextCursor);

    let json: any;
    try {
      json = await tossFetch(`/api/v3/shopping-fep/orders/v2?${params}`, token);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const results: any[] = json?.success?.results ?? [];
    nextCursor = json?.success?.nextCursor ?? null;

    const rows = results.map((item: any) => {
      const skuCode = item.productManagementCode ?? item.productItemManagementCode ?? '';
      const skuId   = skuMap.get(skuCode) ?? null;

      const addr = [item.address, item.detailAddress].filter(Boolean).join(' ').trim();
      const isJeju = /제주|서귀포/.test(addr);

      return {
        channel:         'toss',
        order_date:      (item.orderedAt ?? from).substring(0, 10),
        order_number:    String(item.orderProductId ?? item.orderId ?? ''),
        product_name:    item.productName ?? '',
        option_name:     item.optionName ?? null,
        quantity:        Number(item.quantity ?? 1),
        recipient:       item.receiverName ?? null,
        buyer_phone:     item.receiverPhone ?? item.ordererPhone ?? null,
        address:         addr || null,
        tracking_number: item.shippingTrackingNumber ?? null,
        order_status:    item.orderProductStatus ?? null,
        shipping_cost:   Number(item.deliveryFee ?? 0) + Number(item.jejuDeliveryFee ?? 0) + Number(item.mountainDeliveryFee ?? 0),
        orig_shipping:   Number(item.deliveryFee ?? 0),
        jeju_surcharge:  isJeju && Number(item.jejuDeliveryFee ?? 0) > 0,
        sku_id:          skuId,
      };
    });

    if (rows.length > 0) {
      const { data: inserted, error } = await admin
        .from('channel_orders')
        .upsert(rows, { onConflict: 'order_number,channel', ignoreDuplicates: false })
        .select('id');

      if (error) {
        errors.push(error.message);
        skipped += rows.length;
      } else {
        synced  += inserted?.length ?? 0;
        skipped += rows.length - (inserted?.length ?? 0);
      }
    }

    await sleep(300);
  } while (nextCursor);

  // 재고 자동 차감/복구 (비활성 — 과거 데이터 정리 후 활성화)
  // let deductResult = null;
  // try { deductResult = await applyOrdersToInventory(admin, user.id); } catch {}

  return NextResponse.json({ synced, skipped, errors: errors.length ? errors : undefined });
}
