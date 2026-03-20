import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  // Vercel Cron 인증 (CRON_SECRET 환경변수와 일치해야 함)
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = await createAdminClient();

  const { data: cred } = await admin
    .from('coupang_credentials')
    .select('access_key, secret_key, vendor_id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cred) {
    console.error('[cron/sync-rg-inventory] 쿠팡 자격증명 없음');
    return NextResponse.json({ error: '쿠팡 API 키 없음' }, { status: 400 });
  }

  const credentials = {
    accessKey: cred.access_key,
    secretKey: cred.secret_key,
    vendorId:  cred.vendor_id,
  };

  // platform_skus.platform_sku_id (externalSkuId 또는 vendorItemId) → sku_id 매핑
  const { data: psRows } = await admin
    .from('platform_skus')
    .select('sku_id, platform_sku_id')
    .not('platform_sku_id', 'is', null);
  const platformMap = new Map<string, string>();
  for (const r of psRows ?? []) {
    if (r.sku_id && r.platform_sku_id) platformMap.set(String(r.platform_sku_id), r.sku_id as string);
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const path = `/v2/providers/rg_open_api/apis/api/v1/vendors/${credentials.vendorId}/rg/inventory/summaries`;

  let synced = 0;
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (nextToken) params.nextToken = nextToken;

    let json: any;
    try {
      json = await coupangFetch(path, params, credentials);
    } catch (err: any) {
      console.error('[cron/sync-rg-inventory]', err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    nextToken = json?.nextToken ?? undefined;

    const rows = items.map((item: any) => ({
      snapshot_date:       snapshotDate,
      vendor_item_id:      String(item.vendorItemId),
      external_sku_id:     item.externalSkuId ? String(item.externalSkuId) : null,
      total_orderable_qty: Number(item.inventoryDetails?.totalOrderableQuantity ?? 0),
      sales_last_30d:      Number(item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0),
      sku_id: (item.externalSkuId ? platformMap.get(String(item.externalSkuId)) : undefined)
           ?? platformMap.get(String(item.vendorItemId))
           ?? null,
    }));

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

  console.log(`[cron/sync-rg-inventory] ${snapshotDate} - ${synced}개 완료`);
  return NextResponse.json({ ok: true, synced, snapshot_date: snapshotDate });
}
