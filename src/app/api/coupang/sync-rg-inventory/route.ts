import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INVENTORY_PATH = (vendorId: string) =>
  `/v2/providers/rg_open_api/apis/api/v1/vendors/${vendorId}/rg/inventory/summaries`;

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

  // platform_skus.platform_sku_id → sku_id 매핑 (신상품)
  const { data: psRows } = await admin
    .from('platform_skus')
    .select('sku_id, platform_sku_id, platform_sku_id_return, platform_product_name')
    .not('platform_sku_id', 'is', null);
  const platformMap = new Map<string, string>();
  const returnExtIds = new Set<string>();             // 반품 external_sku_id 집합 (platform_sku_id_return)
  const nameToSkuId = new Map<string, string>();     // 상품명 → sku_id (반품→신상품 자동 연결용)
  for (const r of psRows ?? []) {
    if (r.sku_id && r.platform_sku_id) {
      platformMap.set(String(r.platform_sku_id), r.sku_id as string);
    }
    if ((r as any).platform_sku_id_return) {
      returnExtIds.add(String((r as any).platform_sku_id_return));
    }
    if (r.platform_product_name && r.sku_id) {
      nameToSkuId.set((r.platform_product_name as string).trim().toLowerCase(), r.sku_id as string);
    }
  }

  // 이미 등록된 반품 vendor_item_id
  const { data: existingReturns } = await admin
    .from('rg_return_vendor_items')
    .select('vendor_item_id');
  const existingReturnIds = new Set<string>(
    (existingReturns ?? []).map((r: any) => r.vendor_item_id)
  );

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const path = INVENTORY_PATH(credentials.vendorId);

  let synced = 0;
  let nextToken: string | undefined;
  // 새로 발견된 반품 후보 수집
  const newReturnCandidates: { vendor_item_id: string; extId: string; itemName: string }[] = [];

  do {
    const params: Record<string, string> = {};
    if (nextToken) params.nextToken = nextToken;

    let json: any;
    try {
      json = await coupangFetch(path, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    nextToken = json?.nextToken ?? undefined;

    const rows = items.map((item: any) => {
      const vid = String(item.vendorItemId);
      const extId = item.externalSkuId ? String(item.externalSkuId) : null;
      const itemName = item.vendorItemName ?? item.itemName ?? item.sellerProductName ?? item.productName ?? null;

      // platform_sku_id_return에 해당하고 아직 반품 등록 안 된 항목만 반품 후보
      if (extId && returnExtIds.has(extId) && !existingReturnIds.has(vid)) {
        newReturnCandidates.push({ vendor_item_id: vid, extId, itemName: itemName ?? '' });
      }

      return {
        snapshot_date:       snapshotDate,
        vendor_item_id:      vid,
        external_sku_id:     extId,
        item_name:           itemName,
        total_orderable_qty: Number(item.inventoryDetails?.totalOrderableQuantity ?? 0),
        sales_last_30d:      Number(item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0),
        sku_id: (extId ? platformMap.get(extId) : undefined)
             ?? platformMap.get(vid)
             ?? null,
      };
    });

    if (rows.length > 0) {
      const { data: inserted, error } = await admin
        .from('rg_inventory_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,vendor_item_id', ignoreDuplicates: false })
        .select('id');

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      synced += inserted?.length ?? 0;
    }

    await sleep(300);
  } while (nextToken);

  // 잘못 반품 분류된 항목 정리: rg_return_vendor_items에 있지만 platform_sku_id_return이 아닌 항목 삭제
  // (grade가 수동 설정된 것은 유저가 직접 분류한 것이므로 유지)
  let cleaned = 0;
  if (existingReturns && existingReturns.length > 0) {
    // 모든 스냅샷의 vendor_item_id → external_sku_id 매핑 조회
    const { data: allSnaps } = await admin
      .from('rg_inventory_snapshots')
      .select('vendor_item_id, external_sku_id')
      .eq('snapshot_date', snapshotDate);
    const vidToExt = new Map<string, string>();
    for (const s of allSnaps ?? []) {
      if (s.external_sku_id) vidToExt.set(s.vendor_item_id, s.external_sku_id);
    }

    const toClean = (existingReturns ?? [])
      .map((r: any) => r.vendor_item_id)
      .filter((vid: string) => {
        const ext = vidToExt.get(vid);
        // external_sku_id가 반품 ID도 아니고 신상품 ID에도 없는 것 = 잘못 자동분류된 것
        // 단, platform_sku_id에 매칭되는 것(신상품)도 반품에서 제거
        if (!ext) return false;
        return !returnExtIds.has(ext);
      });

    if (toClean.length > 0) {
      // grade가 null인 것만 삭제 (수동 분류는 유지)
      const { data: deleted } = await admin
        .from('rg_return_vendor_items')
        .delete()
        .in('vendor_item_id', toClean)
        .is('grade', null)
        .select('vendor_item_id');
      cleaned = deleted?.length ?? 0;
    }
  }

  // 새 반품 아이템 자동 등록 (등급은 null, 상품명 매칭으로 신상품 연결)
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

  return NextResponse.json({ synced, snapshot_date: snapshotDate, auto_classified: autoClassified, cleaned });
}
