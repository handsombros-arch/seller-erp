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

  // externalSkuId → sku_id 매핑
  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [String(s.sku_code), s.id]));

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const path = INVENTORY_PATH(credentials.vendorId);

  let synced = 0;
  let nextToken: string | undefined;

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

    const rows = items.map((item: any) => ({
      snapshot_date:       snapshotDate,
      vendor_item_id:      String(item.vendorItemId),
      external_sku_id:     item.externalSkuId ? String(item.externalSkuId) : null,
      total_orderable_qty: Number(item.inventoryDetails?.totalOrderableQuantity ?? 0),
      sales_last_30d:      Number(item.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0),
      sku_id:              item.externalSkuId ? (skuMap.get(String(item.externalSkuId)) ?? null) : null,
    }));

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

  return NextResponse.json({ synced, snapshot_date: snapshotDate });
}
