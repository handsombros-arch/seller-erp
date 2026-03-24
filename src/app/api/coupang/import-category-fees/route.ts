import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

/**
 * POST /api/coupang/import-category-fees
 * 쿠팡 카테고리 xlsx 파일들 업로드 → coupang_category_fees 테이블에 임포트
 * body: FormData with multiple .xlsx files
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const form = await request.formData();
  const files = form.getAll('files') as File[];

  if (!files.length) {
    return NextResponse.json({ error: 'xlsx 파일을 업로드하세요' }, { status: 400 });
  }

  const catMap = new Map<string, { path: string; rate: number }>();

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets['data'];
    if (!ws) continue;

    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (let i = 4; i < data.length; i++) {
      const raw = String(data[i]?.[0] ?? '');
      const fee = parseFloat(data[i]?.[1]);
      const m = raw.match(/^\[(\d+)\]\s*(.+)$/);
      if (m && !isNaN(fee)) {
        catMap.set(m[1], { path: m[2].trim(), rate: fee });
      }
    }
  }

  if (catMap.size === 0) {
    return NextResponse.json({ error: '파싱된 카테고리가 없습니다' }, { status: 400 });
  }

  // 배치 upsert (500개씩)
  const rows = [...catMap.entries()].map(([id, v]) => ({
    category_id: id,
    category_path: v.path,
    commission_rate: v.rate,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await admin
      .from('coupang_category_fees')
      .upsert(batch, { onConflict: 'category_id' });
    if (!error) upserted += batch.length;
  }

  return NextResponse.json({ parsed: catMap.size, upserted });
}
