import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { rows } = await request.json() as { rows: Record<string, string>[] };
  if (!rows?.length) return NextResponse.json({ error: '데이터 없음' }, { status: 400 });

  const admin = await createAdminClient();
  const { data: skus } = await admin.from('skus').select('id, sku_code');
  const skuMap = new Map((skus ?? []).map((s: any) => [s.sku_code, s.id]));

  const grades = ['최상', '상', '중', '미개봉'];
  const upsertRows: any[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const skuCode = String(row['SKU코드'] ?? '').trim();
    if (!skuCode) { errors.push(`${i + 2}행: SKU코드 누락`); continue; }

    const skuId = skuMap.get(skuCode);
    if (!skuId) { errors.push(`${i + 2}행: SKU코드 '${skuCode}' 없음`); continue; }

    for (const g of grades) {
      const val = String(row[g] ?? '').trim().replace(/,/g, '');
      if (val) {
        upsertRows.push({ sku_id: skuId, grade: g, rate: Number(val) || 0 });
      }
    }
  }

  if (upsertRows.length > 0) {
    const { error } = await admin.from('sku_grade_discounts')
      .upsert(upsertRows, { onConflict: 'sku_id,grade' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: upsertRows.length, errors });
}
