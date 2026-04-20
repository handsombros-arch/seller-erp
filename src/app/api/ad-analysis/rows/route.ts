import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { gunzipSync } from 'zlib';

// GET: 현재 유저의 광고 raw rows 전체
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const { data: uploads } = await admin
    .from('ad_uploads')
    .select('filename, row_count, uploaded_at')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false });

  let allRows: unknown[] = [];
  let from = 0;
  const PAGE = 10000;
  while (true) {
    const { data, error } = await admin
      .from('ad_raw_rows')
      .select('data')
      .eq('user_id', user.id)
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    allRows = allRows.concat(data.map((r: { data: unknown }) => r.data));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return NextResponse.json({ uploads: uploads ?? [], rows: allRows, totalRows: allRows.length });
}

// POST: raw rows upsert (user_id 포함, dedup_key 중복은 무시)
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  let body: { filename?: string; rows: Record<string, unknown>[] };
  if (request.headers.get('content-type') === 'application/gzip') {
    const buffer = Buffer.from(await request.arrayBuffer());
    body = JSON.parse(gunzipSync(buffer).toString());
  } else {
    body = await request.json();
  }
  const { rows } = body;
  const filename = body.filename ?? 'bulk';

  if (!rows?.length) {
    return NextResponse.json({ error: '데이터 필요' }, { status: 400 });
  }

  const dedupKey = (r: Record<string, unknown>) =>
    `${r['날짜']}|${r['키워드'] ?? ''}|${r['광고전환매출발생 옵션ID'] ?? ''}|${r['광고 노출 지면'] ?? ''}`;

  const upsertRows = rows.map((r) => ({
    user_id: user.id,
    dedup_key: dedupKey(r),
    data: r,
    filename,
  }));

  let inserted = 0;
  for (let i = 0; i < upsertRows.length; i += 1000) {
    const batch = upsertRows.slice(i, i + 1000);
    const { error } = await admin
      .from('ad_raw_rows')
      .upsert(batch, { onConflict: 'user_id,dedup_key', ignoreDuplicates: true });
    if (!error) inserted += batch.length;
  }

  // ad_uploads 이력 기록 (user_id + filename UNIQUE 로 upsert)
  await admin.from('ad_uploads').upsert({
    user_id: user.id,
    filename,
    row_count: rows.length,
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'user_id,filename' });

  return NextResponse.json({ inserted, total: rows.length });
}

// DELETE: 파일 삭제 (user 자기 데이터만)
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const filename = request.nextUrl.searchParams.get('filename');

  if (filename) {
    await admin.from('ad_raw_rows').delete().eq('user_id', user.id).eq('filename', filename);
    await admin.from('ad_uploads').delete().eq('user_id', user.id).eq('filename', filename);
    return NextResponse.json({ deleted: filename });
  }

  // 전체 삭제 — 내 데이터만
  await admin.from('ad_raw_rows').delete().eq('user_id', user.id);
  await admin.from('ad_uploads').delete().eq('user_id', user.id);
  return NextResponse.json({ deleted: 'all' });
}
