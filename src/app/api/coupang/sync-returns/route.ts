import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { coupangFetch } from '@/lib/coupang/auth';

const RETURNS_PATH = '/v2/providers/seller_api/apis/api/v1/vendor/refunds';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { from, to } = await request.json() as { from: string; to: string };
  if (!from || !to) return NextResponse.json({ error: 'from, to 날짜 필요' }, { status: 400 });

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
    vendorId: cred.vendor_id,
  };

  // SKU 코드 → sku_id 맵
  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [s.sku_code, s.id]));

  const createdAtFrom = `${from}T00:00:00`;
  const createdAtTo   = `${to}T23:59:59`;

  let synced = 0;
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      vendorId: credentials.vendorId,
      createdAtFrom,
      createdAtTo,
      perPage: '50',
    };
    if (nextToken) params.nextToken = nextToken;

    let json: any;
    try {
      json = await coupangFetch(RETURNS_PATH, params, credentials);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const content: any[] = json?.data?.content ?? [];
    nextToken = json?.data?.nextToken ?? undefined;

    const rows: any[] = [];
    for (const ret of content) {
      const returnId = ret.returnId ?? ret.refundId;
      if (!returnId) continue;

      const returnedAt = (ret.createdAt ?? ret.returnedAt ?? '').substring(0, 10) || from;

      for (const item of ret.items ?? [ret]) {
        const vendorItemId = item.vendorItemId ?? null;
        const skuCode      = item.externalVendorSkuCode ?? '';
        const skuId        = skuMap.get(skuCode) ?? null;

        rows.push({
          return_id:      Number(returnId),
          order_id:       ret.orderId ? Number(ret.orderId) : null,
          sku_id:         skuId,
          vendor_item_id: vendorItemId ? Number(vendorItemId) : null,
          product_name:   item.vendorItemName ?? item.productName ?? '쿠팡 상품',
          option_name:    null,
          quantity:       Number(item.quantity ?? 1),
          return_reason:  item.reason ?? item.returnReason ?? null,
          return_type:    ret.returnType ?? 'RETURN',
          status:         ret.status ?? null,
          returned_at:    returnedAt,
        });
      }
    }

    if (rows.length > 0) {
      const { data: inserted, error } = await admin
        .from('coupang_returns')
        .upsert(rows, { onConflict: 'return_id', ignoreDuplicates: true })
        .select('id');

      if (error) {
        console.error('coupang_returns upsert error:', error.message);
      } else {
        synced += inserted?.length ?? 0;
      }
    }

  } while (nextToken);

  return NextResponse.json({ synced });
}
