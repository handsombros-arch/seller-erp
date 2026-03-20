import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

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

  // Step 1: RG inventory → externalSkuId → vendorItemId 맵
  const extToVendor = new Map<string, string>();
  const inventoryPath = `/v2/providers/rg_open_api/apis/api/v1/vendors/${cred.vendor_id}/rg/inventory/summaries`;
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (nextToken) params.nextToken = nextToken;

    let json: any;
    try {
      json = await coupangFetch(inventoryPath, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: `재고 조회 실패: ${err.message}` }, { status: 502 });
    }

    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    nextToken = json?.nextToken ?? undefined;

    for (const item of items) {
      if (item.externalSkuId && item.vendorItemId) {
        extToVendor.set(String(item.externalSkuId), String(item.vendorItemId));
      }
    }

    if (nextToken) await sleep(300);
  } while (nextToken);

  // Step 2: seller-products → vendorItemId → salePrice 맵
  const vendorItemPriceMap = new Map<string, number>();
  const sellerPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  let spNextToken: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (spNextToken) params.nextToken = spNextToken;

    let json: any;
    try {
      json = await coupangFetch(sellerPath, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: `상품 조회 실패: ${err.message}` }, { status: 502 });
    }

    const products: any[] = Array.isArray(json?.data) ? json.data : [];
    spNextToken = json?.nextToken ?? undefined;

    for (const product of products) {
      // 상품 하위 items 배열 형태
      const items: any[] = Array.isArray(product.items) ? product.items : [product];
      for (const item of items) {
        const rgData = item.rocketGrowthItemData;
        if (!rgData) continue;
        const vid = String(item.vendorItemId ?? rgData.vendorItemId ?? '');
        const price = rgData?.priceData?.salePrice ?? rgData?.salePrice;
        if (vid && price != null) {
          vendorItemPriceMap.set(vid, Number(price));
        }
      }
    }

    if (spNextToken) await sleep(300);
  } while (spNextToken);

  // Step 3: 쿠팡 채널 platform_skus 조회
  const { data: coupangChannels } = await admin
    .from('channels')
    .select('id')
    .eq('type', 'coupang');

  const coupangChannelIds = (coupangChannels ?? []).map((c: any) => c.id);
  if (!coupangChannelIds.length) {
    return NextResponse.json({ error: '쿠팡 채널이 없습니다' }, { status: 400 });
  }

  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('sku_id, channel_id, platform_sku_id')
    .in('channel_id', coupangChannelIds)
    .not('platform_sku_id', 'is', null);

  // Step 4: 매핑 후 업데이트
  let updatedCount = 0;
  let notFoundCount = 0;

  for (const ps of platformSkus ?? []) {
    const currentId = String(ps.platform_sku_id);
    // externalSkuId(8자리)인 경우 → vendorItemId로 변환
    const vendorItemId = extToVendor.get(currentId) ?? currentId;
    const price = vendorItemPriceMap.get(vendorItemId);

    if (!price) { notFoundCount++; continue; }

    const row: any = { platform_sku_id: vendorItemId, price };
    const { error } = await admin
      .from('platform_skus')
      .update(row)
      .eq('sku_id', ps.sku_id)
      .eq('channel_id', ps.channel_id);

    if (!error) updatedCount++;
  }

  return NextResponse.json({
    inventoryMapped: extToVendor.size,
    priceMapped: vendorItemPriceMap.size,
    updated: updatedCount,
    notFound: notFoundCount,
  });
}
