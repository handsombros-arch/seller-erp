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

  // Build SKU code → id map
  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuCodeMap = new Map<string, string>();
  for (const s of skus ?? []) skuCodeMap.set(s.sku_code.trim().toLowerCase(), s.id);

  let upserted = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const channelName = String(row['채널상품명'] ?? '').trim();
    const skuCode = String(row['SKU코드'] ?? '').trim();
    if (!channelName || !skuCode) continue;

    const skuId = skuCodeMap.get(skuCode.toLowerCase());
    if (!skuId) { errors.push(`SKU코드 "${skuCode}" 없음`); continue; }

    const { error } = await admin
      .from('sku_name_aliases')
      .upsert({ channel_name: channelName, sku_id: skuId }, { onConflict: 'channel_name' });

    if (error) {
      errors.push(`"${channelName}": ${error.message}`);
    } else {
      upserted++;
    }
  }

  return NextResponse.json({ upserted, errors });
}
