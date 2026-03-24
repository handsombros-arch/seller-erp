import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET: DB에서 모든 광고 raw rows 가져오기
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 업로드 파일 목록
  const { data: uploads } = await admin
    .from('ad_uploads')
    .select('filename, row_count, uploaded_at')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false });

  // raw rows 전체 (페이징 없이 — 최대 100K행 예상)
  let allRows: any[] = [];
  let from = 0;
  const PAGE = 10000;
  while (true) {
    const { data, error } = await admin
      .from('ad_raw_rows')
      .select('data')
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    allRows = allRows.concat(data.map((r: any) => r.data));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return NextResponse.json({ uploads: uploads ?? [], rows: allRows, totalRows: allRows.length });
}

// POST: 새 파일 업로드 (raw rows upsert)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const { filename, rows } = await request.json() as { filename: string; rows: any[] };

  if (!filename || !rows?.length) {
    return NextResponse.json({ error: '파일명과 데이터 필요' }, { status: 400 });
  }

  // 파일명 중복 체크
  const { data: existing } = await admin
    .from('ad_uploads')
    .select('id')
    .eq('user_id', user.id)
    .eq('filename', filename)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: `이미 업로드된 파일: ${filename}`, duplicate: true }, { status: 409 });
  }

  // dedup key 생성 + upsert
  const dedupKey = (r: any) => `${r['날짜']}|${r['키워드'] ?? ''}|${r['광고전환매출발생 옵션ID'] ?? ''}|${r['광고 노출 지면'] ?? ''}`;

  const upsertRows = rows.map((r: any) => ({
    dedup_key: dedupKey(r),
    data: r,
    filename,
  }));

  // 배치 upsert (1000개씩)
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < upsertRows.length; i += 1000) {
    const batch = upsertRows.slice(i, i + 1000);
    const { data: result, error } = await admin
      .from('ad_raw_rows')
      .upsert(batch, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('dedup_key');
    if (!error) inserted += result?.length ?? 0;
    else skipped += batch.length;
  }

  // 업로드 기록 저장
  await admin.from('ad_uploads').insert({
    user_id: user.id,
    filename,
    row_count: rows.length,
  });

  return NextResponse.json({ inserted, skipped: rows.length - inserted, total: rows.length });
}

// DELETE: 파일 삭제
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const filename = request.nextUrl.searchParams.get('filename');

  if (filename) {
    // 특정 파일 삭제
    await admin.from('ad_raw_rows').delete().eq('filename', filename);
    await admin.from('ad_uploads').delete().eq('user_id', user.id).eq('filename', filename);
    return NextResponse.json({ deleted: filename });
  }

  // 전체 삭제
  await admin.from('ad_raw_rows').delete().neq('dedup_key', '');
  await admin.from('ad_uploads').delete().eq('user_id', user.id);
  return NextResponse.json({ deleted: 'all' });
}
