import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/coupang/sync-commission
 * 쿠팡 상품 → 카테고리 → 판매대행수수료율 자동 동기화
 * (전자결제수수료 3% 제외, VAT 제외)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 1. 쿠팡 자격증명
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
    vendorId: cred.vendor_id,
  };

  // 2. 카테고리 → 수수료 맵 (coupang_category_fees 테이블)
  const { data: catFees } = await admin
    .from('coupang_category_fees')
    .select('category_id, commission_rate');

  const feeMap = new Map<string, number>();
  for (const row of catFees ?? []) {
    feeMap.set(String(row.category_id), Number(row.commission_rate));
  }

  if (feeMap.size === 0) {
    return NextResponse.json({ error: '카테고리 수수료 데이터가 없습니다. 먼저 임포트하세요.' }, { status: 400 });
  }

  // 3. 쿠팡 상품 목록 → sellerProductId + displayCategoryCode
  const sellerPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  const productCategoryMap = new Map<string, { name: string; categoryCode: string; rate: number }>();
  // vendorItemId → { sellerProductId, commissionRate }
  const vendorItemCommission = new Map<string, number>();
  let spNextToken: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (spNextToken) params.nextToken = spNextToken;

    let json: any;
    try {
      json = await coupangFetch(sellerPath, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: `상품 목록 조회 실패: ${err.message}` }, { status: 502 });
    }

    const products: any[] = Array.isArray(json?.data) ? json.data : [];
    spNextToken = json?.nextToken ?? undefined;

    for (const p of products) {
      const catCode = String(p.displayCategoryCode ?? '');
      const rate = feeMap.get(catCode);
      const spId = String(p.sellerProductId);

      productCategoryMap.set(spId, {
        name: p.sellerProductName ?? '',
        categoryCode: catCode,
        rate: rate ?? 0,
      });

      // 상품 상세에서 vendorItemId 가져오기
      if (rate != null) {
        try {
          const detailPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${spId}`;
          const detail = await coupangFetch(detailPath, {}, credentials);
          const items: any[] = detail?.data?.items ?? [];
          for (const item of items) {
            const vid = String(item.vendorItemId ?? '');
            if (vid && vid !== 'undefined') {
              vendorItemCommission.set(vid, rate);
            }
          }
          await sleep(300);
        } catch {
          // 상세 조회 실패 시 상품명으로 매칭 시도 (아래에서 처리)
        }
      }
    }

    if (spNextToken) await sleep(300);
  } while (spNextToken);

  // 4. 쿠팡 채널 platform_skus 조회
  const { data: coupangChannels } = await admin
    .from('channels')
    .select('id')
    .eq('type', 'coupang');

  const channelIds = (coupangChannels ?? []).map((c: any) => c.id);
  if (!channelIds.length) {
    return NextResponse.json({ error: '쿠팡 채널이 없습니다' }, { status: 400 });
  }

  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('sku_id, channel_id, platform_sku_id, platform_product_name')
    .in('channel_id', channelIds)
    .not('platform_sku_id', 'is', null);

  // 5. vendorItemId 직접 매칭 실패 시 상품명으로 폴백 매칭
  const nameToRate = new Map<string, number>();
  for (const [, info] of productCategoryMap) {
    if (info.rate > 0 && info.name) {
      nameToRate.set(info.name.trim().toLowerCase(), info.rate);
    }
  }

  // 6. platform_skus 업데이트
  let updated = 0;
  let notFound = 0;
  const results: { sku: string; name: string; rate: number | null }[] = [];

  for (const ps of platformSkus ?? []) {
    const vid = String(ps.platform_sku_id);
    let rate = vendorItemCommission.get(vid);

    // 폴백: 상품명 매칭
    if (rate == null && ps.platform_product_name) {
      rate = nameToRate.get(ps.platform_product_name.trim().toLowerCase());
    }

    if (rate != null && rate > 0) {
      const { error } = await admin
        .from('platform_skus')
        .update({ commission_rate: rate })
        .eq('sku_id', ps.sku_id)
        .eq('channel_id', ps.channel_id);

      if (!error) updated++;
      results.push({ sku: vid, name: (ps.platform_product_name ?? '').slice(0, 30), rate });
    } else {
      notFound++;
      results.push({ sku: vid, name: (ps.platform_product_name ?? '').slice(0, 30), rate: null });
    }
  }

  return NextResponse.json({
    categoriesLoaded: feeMap.size,
    productsFound: productCategoryMap.size,
    updated,
    notFound,
    details: results,
  });
}
