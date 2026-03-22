import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getTossToken, tossFetch } from '@/lib/toss/auth';
import { buildSkuMatcher } from '@/lib/inventory/matchSku';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 토스 클레임(취소/반품/교환) 동기화
 * - 전체 클레임 페이지네이션으로 조회
 * - orderProductId로 기존 주문 매칭 → claim_status/claim_type/claim_date 업데이트
 * - COMPLETED 상태의 최신 클레임만 반영 (같은 주문에 여러 클레임이 있을 수 있음)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

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
  let updated = 0;
  const errors: string[] = [];
  const processed = new Set<string>(); // orderProductId 중복 방지

  let nextToken: string | null = null;
  do {
    const params = new URLSearchParams({ size: '100' });
    if (nextToken) params.set('nextToken', nextToken);

    let json: any;
    try {
      json = await tossFetch(`/api/v3/shopping-fep/claims?${params}`, token);
    } catch (err: any) {
      errors.push(err.message);
      break;
    }

    const items: any[] = json?.success?.items ?? [];
    nextToken = json?.success?.hasNext ? (json?.success?.nextToken ?? null) : null;

    for (const claim of items) {
      const orderProductId = String(claim.order?.orderProductId ?? '');
      if (!orderProductId || processed.has(orderProductId)) continue;
      processed.add(orderProductId);

      const claimType = claim.type ?? 'RETURN';
      const claimStatus = `${claimType}_${claim.status ?? 'REQUESTED'}`;
      const claimDate = claim.requestedDt ? claim.requestedDt.substring(0, 10) : null;

      // 기존 주문 매칭 (orderProductId = order_number)
      const { data: existing } = await admin
        .from('channel_orders')
        .select('id')
        .eq('order_number', orderProductId)
        .eq('channel', 'toss')
        .limit(1)
        .maybeSingle();

      if (existing) {
        await admin.from('channel_orders').update({
          claim_status: claimStatus,
          claim_type: claimType,
          claim_date: claimDate,
        }).eq('id', existing.id);
        updated++;
      }
      // 기존 주문이 없으면 무시 (주문 동기화에서 먼저 들어와야 함)
    }

    synced += items.length;
    await sleep(300);
  } while (nextToken);

  return NextResponse.json({ synced, updated, errors: errors.length ? errors : undefined });
}
