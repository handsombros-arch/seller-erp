import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';
import { buildSkuMatcher } from '@/lib/inventory/matchSku';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 쿠팡 Wing 반품/취소 동기화
 * - /v6/vendors/{vendorId}/returnRequests
 * - 31일 제한 → 30일 단위 분할
 * - cancelType: RETURN (반품) + CANCEL (취소)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { from, to } = await request.json() as { from: string; to: string };
  if (!from || !to) return NextResponse.json({ error: 'from, to 날짜 필요' }, { status: 400 });

  const admin = await createAdminClient();
  const matcher = await buildSkuMatcher(admin);

  const { data: cred } = await admin
    .from('coupang_credentials')
    .select('access_key, secret_key, vendor_id')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  if (!cred) return NextResponse.json({ error: '쿠팡 API 키를 먼저 설정하세요' }, { status: 400 });

  const credentials = { accessKey: cred.access_key, secretKey: cred.secret_key, vendorId: cred.vendor_id };
  const basePath = `/v2/providers/openapi/apis/api/v6/vendors/${credentials.vendorId}/returnRequests`;

  let synced = 0;
  const errors: string[] = [];

  // 30일 단위 분할
  const chunks: { start: string; end: string }[] = [];
  let cs = new Date(from);
  const fe = new Date(to);
  while (cs <= fe) {
    const ce = new Date(Math.min(cs.getTime() + 29 * 86400000, fe.getTime()));
    chunks.push({ start: cs.toISOString().slice(0, 10), end: ce.toISOString().slice(0, 10) });
    cs = new Date(ce.getTime() + 86400000);
  }

  for (const chunk of chunks) {
    for (const cancelType of ['RETURN', 'CANCEL'] as const) {
      try {
        const params: Record<string, string> = {
          searchType: 'timeFrame',
          createdAtFrom: `${chunk.start}T00:00`,
          createdAtTo: `${chunk.end}T23:59`,
        };
        if (cancelType === 'CANCEL') params.cancelType = 'CANCEL';

        const json = await coupangFetch(basePath, params, credentials);
        const items: any[] = Array.isArray(json?.data) ? json.data : [];

        for (const ret of items) {
          const returnedAt = ret.createdAt ? ret.createdAt.substring(0, 10) : chunk.start;
          const isCompleted = (ret.receiptStatus ?? '').includes('COMPLETED');

          for (const item of ret.returnItems ?? []) {
            const vendorItemId = item.vendorItemId ? String(item.vendorItemId) : null;
            const skuId = vendorItemId
              ? (matcher.byVendorItemId(vendorItemId) ?? matcher.byNameOption(item.sellerProductName ?? '', item.vendorItemName))
              : matcher.byNameOption(item.sellerProductName ?? '', item.vendorItemName);

            // channel_orders에서 해당 주문 찾아서 claim 업데이트
            const shipmentKey = item.shipmentBoxId ? `${item.shipmentBoxId}-${vendorItemId}` : null;
            if (shipmentKey) {
              const { data: existing } = await admin.from('channel_orders')
                .select('id').eq('order_number', shipmentKey).eq('channel', 'coupang').limit(1).maybeSingle();
              if (existing) {
                await admin.from('channel_orders').update({
                  claim_type: cancelType,
                  claim_status: ret.receiptStatus,
                  claim_date: returnedAt,
                }).eq('id', existing.id);
              }
            }

            // coupang_returns에도 저장
            await admin.from('coupang_returns').upsert({
              return_id: ret.receiptId,
              order_id: ret.orderId ?? null,
              sku_id: skuId,
              vendor_item_id: vendorItemId ? Number(vendorItemId) : null,
              product_name: item.sellerProductName ?? item.vendorItemName ?? '',
              option_name: item.vendorItemName ?? null,
              quantity: Number(item.cancelCount ?? 1),
              return_reason: ret.cancelReason || ret.reasonCodeText || ret.cancelReasonCategory2 || null,
              return_type: cancelType,
              status: ret.receiptStatus,
              returned_at: returnedAt,
            }, { onConflict: 'return_id', ignoreDuplicates: false });

            synced++;
          }
        }
      } catch (err: any) {
        errors.push(`[Wing/${cancelType}/${chunk.start}] ${err.message}`);
      }
      await sleep(400);
    }
    await sleep(300);
  }

  return NextResponse.json({ synced, errors: errors.length ? errors : undefined });
}
