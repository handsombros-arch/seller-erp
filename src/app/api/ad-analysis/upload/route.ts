import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export const maxDuration = 120;

// POST: xlsx/csv 파일을 FormData로 직접 수신 → 서버에서 파싱 → DB 저장
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

  const filename = file.name;

  // 중복 체크
  const { data: existing } = await admin
    .from('ad_uploads')
    .select('id')
    .eq('user_id', user.id)
    .eq('filename', filename)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: `이미 업로드된 파일: ${filename}`, duplicate: true }, { status: 409 });
  }

  // 파일 파싱
  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);

  if (!rows.length) {
    return NextResponse.json({ error: '빈 파일' }, { status: 400 });
  }

  // dedup key 생성
  const dedupKey = (r: any) =>
    `${r['날짜']}|${r['키워드'] ?? ''}|${r['광고전환매출발생 옵션ID'] ?? ''}|${r['광고 노출 지면'] ?? ''}`;

  // 배치 upsert (2000개씩 — 서버 내부이므로 body size 제한 없음)
  let inserted = 0;
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r: any) => ({
      dedup_key: dedupKey(r),
      data: r,
      filename,
    }));
    const { data: result, error } = await admin
      .from('ad_raw_rows')
      .upsert(batch, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('dedup_key');
    if (!error) inserted += result?.length ?? 0;
  }

  // 업로드 기록
  await admin.from('ad_uploads').insert({
    user_id: user.id,
    filename,
    row_count: rows.length,
  });

  return NextResponse.json({ inserted, total: rows.length, skipped: rows.length - inserted });
}
