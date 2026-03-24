import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * RG 재고 동기화 핵심 로직 (직접 호출용)
 */
export async function runSyncRgInventory(): Promise<Record<string, any>> {
  const admin = await createAdminClient();

  const { data: cred } = await admin
    .from('coupang_credentials')
    .select('access_key, secret_key, vendor_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) {
    console.error('[cron/sync-rg-inventory] 쿠팡 자격증명 없음');
    return { error: '쿠팡 API 키 없음' };
  }

  const credentials = {
    accessKey: cred.access_key,
    secretKey: cred.secret_key,
    vendorId:  cred.vendor_id,
  };

  // platform_skus.platform_sku_id → sku_id 매핑 (신상품)
  const { data: psRows } = await admin
    .from('platform_skus')
    .select('sku_id, platform_sku_id, platform_product_name')
    .not('platform_sku_id', 'is', null);
  const platformMap = new Map<string, string>();
  const newProductExtIds = new Set<string>();
  const nameToSkuId = new Map<string, string>();
  for (const r of psRows ?? []) {
    if (r.sku_id && r.platform_sku_id) {
      platformMap.set(String(r.platform_sku_id), r.sku_id as string);
      newProductExtIds.add(String(r.platform_sku_id));
    }
    if (r.platform_product_name && r.sku_id) {
      nameToSkuId.set((r.platform_product_name as string).trim().toLowerCase(), r.sku_id as string);
    }
  }

  const { data: existingReturns } = await admin
    .from('rg_return_vendor_items')
    .select('vendor_item_id');
  const existingReturnIds = new Set<string>(
    (existingReturns ?? []).map((r: any) => r.vendor_item_id)
  );

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const path = `/v2/providers/rg_open_api/apis/api/v1/vendors/${credentials.vendorId}/rg/inventory/summaries`;

  let synced = 0;
  let nextToken: string | undefined;
  const newReturnCandidates: { vendor_item_id: string; extId: string; itemName: string }[] = [];

  do {
    const params: Record<string, string> = {};
    if (nextToken) params.nextToken = nextToken;

    let json: any;
    try {
      json = await coupangFetch(path, params, credentials);
    } catch (err: any) {
      console.error('[cron/sync-rg-inventory]', err.message);
      return { error: err.message };
    }

    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    nextToken = json?.nextToken ?? undefined;

    const rows = items.map((item: any) => {
      const vid = String(item.vendorItemId);
      const extId = item.externalSkuId ? String(item.externalSkuId) : null;
      const itemName = item.vendorItemName ?? item.itemName ?? item.sellerProductName ?? item.productName ?? null;

      if (extId && !newProductExtIds.has(extId) && !existingReturnIds.has(vid)) {
        newReturnCandidates.push({ vendor_item_id: vid, extId, itemName: itemName ?? '' });
      }

      return {
        snapshot_date:       snapshotDate,
        vendor_item_id:      vid,
        external_sku_id:     extId,
        total_orderable_qty: Number(item.inventoryDetails?.totalOrderableQuantity ?? 0),
        sales_last_30d:      Number(item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0),
        sku_id: (extId ? platformMap.get(extId) : undefined)
             ?? platformMap.get(vid)
             ?? null,
      };
    });

    if (rows.length > 0) {
      const { error } = await admin
        .from('rg_inventory_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,vendor_item_id', ignoreDuplicates: false });

      if (error) {
        console.error('[cron/sync-rg-inventory] upsert error:', error.message);
      } else {
        synced += rows.length;
      }
    }

    await sleep(300);
  } while (nextToken);

  // 새 반품 아이템 자동 등록
  let autoClassified = 0;
  if (newReturnCandidates.length > 0) {
    const returnRows = newReturnCandidates.map((c) => ({
      vendor_item_id: c.vendor_item_id,
      grade: null,
      sku_id: nameToSkuId.get(c.itemName.trim().toLowerCase()) ?? null,
    }));
    const { data: upserted } = await admin
      .from('rg_return_vendor_items')
      .upsert(returnRows, { onConflict: 'vendor_item_id', ignoreDuplicates: true })
      .select('vendor_item_id');
    autoClassified = upserted?.length ?? 0;
  }

  console.log(`[cron/sync-rg-inventory] ${snapshotDate} - ${synced}개 동기화, ${autoClassified}개 반품 자동분류`);
  return { ok: true, synced, snapshot_date: snapshotDate, auto_classified: autoClassified };
}

/**
 * HTTP 엔드포인트 (수동 트리거용)
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runSyncRgInventory();
  return NextResponse.json(result);
}
