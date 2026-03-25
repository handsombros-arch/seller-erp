import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getTossToken, tossFetch } from '@/lib/toss/auth';
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
    .from('toss_credentials')
    .select('access_key, secret_key')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) return NextResponse.json({ error: '토스 API 키를 먼저 설정하세요' }, { status: 400 });

  const matcher = await buildSkuMatcher(admin);

  let token: string;
  try {
    token = await getTossToken({ accessKey: cred.access_key, secretKey: cred.secret_key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  // 31일 제한 → 30일 단위로 자동 분할
  const chunks: { start: string; end: string }[] = [];
  let chunkStart = new Date(from);
  const finalEnd = new Date(to);
  while (chunkStart <= finalEnd) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + 29 * 86400000, finalEnd.getTime()));
    chunks.push({ start: chunkStart.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    chunkStart = new Date(chunkEnd.getTime() + 86400000);
  }

  for (const chunk of chunks) {
    let nextCursor: string | null = null;

    do {
      const params = new URLSearchParams({
        startDate: chunk.start,
        endDate:   chunk.end,
        limit:     '50',
      });
      if (nextCursor) params.set('nextCursor', nextCursor);

      let json: any;
      try {
        json = await tossFetch(`/api/v3/shopping-fep/orders/v2?${params}`, token);
      } catch (err: any) {
        errors.push(`[${chunk.start}~${chunk.end}] ${err.message}`);
        break;
      }

      const results: any[] = json?.success?.results ?? [];
      nextCursor = json?.success?.nextCursor ?? null;

      const rows = results.map((item: any) => {
        const skuCode = item.productManagementCode ?? item.productItemManagementCode ?? '';
        const skuId   = matcher.byCode(skuCode)
                     ?? matcher.byNameOption(item.productName ?? '', item.optionName)
                     ?? null;

        const addr = [item.address, item.detailAddress].filter(Boolean).join(' ').trim();
        const isJeju = /제주|서귀포/.test(addr);

        return {
          channel:         'toss',
          order_date:      (item.orderedAt ?? chunk.start).substring(0, 10),
          order_time:      (() => { const raw = item.orderedAt ?? ''; return raw.length > 10 ? raw.substring(11, 19) : null; })(),
          order_number:    String(item.orderProductId ?? item.orderId ?? ''),
          product_name:    item.productName ?? '',
          option_name:     item.optionName ?? null,
          quantity:        Number(item.quantity ?? 1),
          recipient:       item.receiverName ?? null,
          buyer_phone:     item.receiverPhone ?? item.ordererPhone ?? null,
          address:         addr || null,
          tracking_number: item.shippingTrackingNumber ?? null,
          order_status:    item.orderProductStatus ?? null,
          claim_date:      item.canceledAt ? item.canceledAt.substring(0, 10) : (item.returnedAt ? item.returnedAt.substring(0, 10) : null),
          shipping_cost:   2650 + (isJeju ? 3000 : 0),
          orig_shipping:   2650,
          jeju_surcharge:  isJeju,
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

    await sleep(500); // 청크 간 rate limit
  }

  // 재고 자동 차감/복구
  let deductResult = null;
  try { deductResult = await applyOrdersToInventory(admin, user.id); } catch {}

  return NextResponse.json({ synced, skipped, errors: errors.length ? errors : undefined, deducted: deductResult?.applied ?? 0, restored: deductResult?.restored ?? 0 });
}
