import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getTossToken, tossFetch } from '@/lib/toss/auth';
import { buildSkuMatcher } from '@/lib/inventory/matchSku';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 토스 클레임(취소/반품/교환) 동기화
 * - 주문 API에는 반품 정보가 없음 → 별도 claims API 사용
 * - 7일 단위 조회 제한 → 자동 분할
 * - channel_orders의 claim_status, claim_type, claim_date 업데이트
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
    .from('toss_credentials')
    .select('access_key, secret_key')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  if (!cred) return NextResponse.json({ error: '토스 API 키를 먼저 설정하세요' }, { status: 400 });

  let token: string;
  try {
    token = await getTossToken({ accessKey: cred.access_key, secretKey: cred.secret_key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  let synced = 0;
  const errors: string[] = [];

  // 7일 단위 분할
  const chunks: { start: string; end: string }[] = [];
  let chunkStart = new Date(from);
  const finalEnd = new Date(to);
  while (chunkStart <= finalEnd) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + 6 * 86400000, finalEnd.getTime()));
    chunks.push({ start: chunkStart.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    chunkStart = new Date(chunkEnd.getTime() + 86400000);
  }

  for (const chunk of chunks) {
    // 각 유형별 조회
    for (const type of ['CANCEL', 'RETURN', 'EXCHANGE'] as const) {
      let nextToken: string | null = null;

      do {
        const params = new URLSearchParams({
          type,
          status: 'REQUESTED',
          fromRequestDate: chunk.start,
          toRequestDate: chunk.end,
          size: '100',
        });
        if (nextToken) params.set('nextToken', nextToken);

        let json: any;
        try {
          json = await tossFetch(`/api/v3/shopping-fep/claims?${params}`, token);
        } catch (err: any) {
          errors.push(`[${type}/${chunk.start}] ${err.message}`);
          break;
        }

        const items: any[] = json?.success?.items ?? [];
        nextToken = json?.success?.hasNext ? (json?.success?.nextToken ?? null) : null;

        for (const claim of items) {
          const orderProductId = String(claim.order?.orderProductId ?? '');
          const claimDate = claim.requestedDt ? claim.requestedDt.substring(0, 10) : null;
          const claimType = type;
          const claimStatus = `${type}_REQUESTED`;
          const productName = claim.product?.name ?? '';
          const optionName = claim.product?.optionName ?? null;
          const quantity = claim.product?.quantity ?? 1;
          const reason = claim.requestReason ?? null;

          // channel_orders에서 해당 주문 찾기
          if (orderProductId) {
            const { data: existing } = await admin
              .from('channel_orders')
              .select('id')
              .eq('order_number', orderProductId)
              .eq('channel', 'toss')
              .limit(1)
              .maybeSingle();

            if (existing) {
              // 기존 주문 업데이트
              await admin.from('channel_orders').update({
                claim_status: claimStatus,
                claim_type: claimType,
                claim_date: claimDate,
              }).eq('id', existing.id);
              synced++;
            } else {
              // 주문이 없으면 새로 생성
              const skuId = matcher.byNameOption(productName, optionName);
              await admin.from('channel_orders').upsert({
                channel: 'toss',
                order_date: claimDate ?? chunk.start,
                order_number: orderProductId,
                product_name: productName,
                option_name: optionName,
                quantity,
                order_status: claimStatus,
                claim_status: claimStatus,
                claim_type: claimType,
                claim_date: claimDate,
                shipping_cost: 0,
                orig_shipping: 0,
                jeju_surcharge: false,
                sku_id: skuId,
                recipient: claim.order?.receiverName ?? null,
                buyer_phone: claim.order?.receiverPhoneNumber ?? null,
                address: claim.order?.address ?? null,
              }, { onConflict: 'order_number,channel', ignoreDuplicates: false });
              synced++;
            }
          }
        }

        await sleep(300);
      } while (nextToken);
    }

    await sleep(500);
  }

  return NextResponse.json({ synced, errors: errors.length ? errors : undefined });
}
