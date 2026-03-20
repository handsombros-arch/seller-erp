import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { rows } = body as { rows: Record<string, string>[] };
  if (!rows?.length) return NextResponse.json({ error: '데이터 없음' }, { status: 400 });

  const admin = await createAdminClient();

  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [s.sku_code, s.id]));

  const { data: channels } = await admin.from('channels').select('id, name');
  const channelMap = new Map((channels ?? []).map((c: any) => [c.name, c.id]));

  const upsertRows: any[] = [];
  const aliasRows: { channel_name: string; sku_id: string }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const skuCode    = String(row['SKU코드']    ?? '').trim();
    const channelName = String(row['채널명']     ?? '').trim();
    if (!skuCode)     { errors.push(`${rowNum}행: SKU코드 누락`);  continue; }
    if (!channelName) { errors.push(`${rowNum}행: 채널명 누락`);   continue; }

    const skuId = skuMap.get(skuCode);
    if (!skuId) { errors.push(`${rowNum}행: SKU코드 '${skuCode}' 없음`); continue; }

    const channelId = channelMap.get(channelName);
    if (!channelId) { errors.push(`${rowNum}행: 채널명 '${channelName}' 없음 (설정>채널에서 확인)`); continue; }

    const platformProductName = String(row['플랫폼상품명'] ?? '').trim() || null;
    const platformProductId   = String(row['플랫폼상품ID'] ?? '').trim() || null;
    const priceRaw = String(row['판매가'] ?? '').trim().replace(/,/g, '');
    const price    = priceRaw ? Number(priceRaw) : null;

    upsertRows.push({ sku_id: skuId, channel_id: channelId, platform_product_name: platformProductName, platform_product_id: platformProductId, price });
    if (platformProductName) aliasRows.push({ channel_name: platformProductName, sku_id: skuId });
  }

  if (upsertRows.length) {
    const { error } = await admin.from('platform_skus').upsert(upsertRows, { onConflict: 'sku_id,channel_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const a of aliasRows) {
    await admin.from('sku_name_aliases').upsert(a, { onConflict: 'channel_name' });
  }

  return NextResponse.json({ upserted: upsertRows.length, errors });
}
