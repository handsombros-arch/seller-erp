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

  // Step 1: RG inventory (전체 페이징) → externalSkuId(8자리) → vendorItemId(11자리) 맵
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

  // Step 2: seller-products 목록 → sellerProductId 수집
  const sellerProductIds: number[] = [];
  const sellerPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  let spNextToken: string | undefined;

  do {
    const params: Record<string, string> = { vendorId: cred.vendor_id, maxPerPage: '50' };
    if (spNextToken) params.nextToken = spNextToken;

    let json: any;
    try {
      json = await coupangFetch(sellerPath, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: `상품 목록 조회 실패: ${err.message}` }, { status: 502 });
    }

    const products: any[] = Array.isArray(json?.data) ? json.data : [];
    spNextToken = json?.nextToken ?? undefined;

    for (const product of products) {
      if (product.sellerProductId) {
        sellerProductIds.push(product.sellerProductId);
      }
    }

    if (spNextToken) await sleep(300);
  } while (spNextToken);

  // Step 3: 각 상품 상세 조회 → vendorItemId + salePrice 수집
  const vendorItemPriceMap = new Map<string, number>();

  for (const spId of sellerProductIds) {
    const detailPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${spId}`;
    try {
      const detail = await coupangFetch(detailPath, {}, credentials);
      const d = detail.data ?? detail;
      const items: any[] = d.items ?? [];

      for (const item of items) {
        // RG 상품: rocketGrowthItemData 안에 vendorItemId + salePrice
        const rgData = item.rocketGrowthItemData;
        if (rgData) {
          const vid = String(rgData.vendorItemId ?? '');
          const price = rgData.salePrice ?? rgData.priceData?.salePrice;
          if (vid && price != null) {
            vendorItemPriceMap.set(vid, Number(price));
          }
        }
        // Wing 상품: item 직접 vendorItemId + salePrice
        else if (item.vendorItemId && item.salePrice != null) {
          vendorItemPriceMap.set(String(item.vendorItemId), Number(item.salePrice));
        }
      }
    } catch {
      // 개별 상품 조회 실패는 무시
    }
    await sleep(300);
  }

  // Step 4: 쿠팡 채널 platform_skus 조회
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
    .select('sku_id, channel_id, platform_sku_id, price')
    .in('channel_id', coupangChannelIds)
    .not('platform_sku_id', 'is', null);

  // Step 5: ID 매핑만 업데이트 (가격은 수기 입력 전용, API 가격 사용 안 함)
  // - platform_sku_id: externalSkuId(8자리) → vendorItemId(11자리) 갱신
  let updatedCount = 0;
  let notFoundCount = 0;

  for (const ps of platformSkus ?? []) {
    const currentId = String(ps.platform_sku_id);
    const vendorItemId = extToVendor.get(currentId) ?? currentId;

    // ID가 이미 동일하면 스킵
    if (vendorItemId === currentId) { notFoundCount++; continue; }

    const { error } = await admin
      .from('platform_skus')
      .update({ platform_sku_id: vendorItemId })
      .eq('sku_id', ps.sku_id)
      .eq('channel_id', ps.channel_id);

    if (!error) updatedCount++;
  }

  return NextResponse.json({
    inventoryMapped: extToVendor.size,
    productsScanned: sellerProductIds.length,
    priceMapped: vendorItemPriceMap.size,
    updated: updatedCount,
    skipped: notFoundCount,
  });
}
