import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { gunzipSync } from 'zlib';
import { adRowKey, packAdRows, unpackAdRows, type AdRow } from '@/lib/ad-analysis/sync';

export const maxDuration = 60;

// GET: 현재 유저의 광고 raw rows 전체. ?stats=1 로 통계만 빠르게 반환.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // Bounded responses avoid serverless time/body limits for large histories.
  if (request.nextUrl.searchParams.has('page')) {
    const page = Number(request.nextUrl.searchParams.get('page'));
    if (!Number.isSafeInteger(page) || page < 0) return NextResponse.json({ error: '잘못된 페이지' }, { status: 400 });
    const size = 500;
    // Count without loading JSONB: combining exact count with data selection
    // can make PostgREST materialize the entire account history.
    let count: number | null = null;
    if (page === 0) {
      const result = await admin.from('ad_raw_rows').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
      if (result.error) return NextResponse.json({ error: `건수 조회: ${result.error.message}` }, { status: 500 });
      count = result.count;
    }
    const { data, error } = await admin.from('ad_raw_rows')
      .select('data')
      .eq('user_id', user.id).order('dedup_key', { ascending: true })
      .range(page * size, (page + 1) * size - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: unpackAdRows((data ?? []).map(r => r.data as AdRow)),
      storedCount: page === 0 ? count : undefined, pageSize: size, page });
  }

  const { data: uploads } = await admin
    .from('ad_uploads')
    .select('filename, row_count, uploaded_at')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false });

  // 진단용: 전체 행 안 가져오고 count + uploads 만 반환 (DB 잠자고 있는 데이터 양 판단용)
  if (request.nextUrl.searchParams.get('stats') === '1') {
    const { count } = await admin
      .from('ad_raw_rows')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    const totalFromUploads = (uploads ?? []).reduce((s, u) => s + (u.row_count ?? 0), 0);
    return NextResponse.json({
      uploads: uploads ?? [],
      rawRowsCount: count ?? 0,
      uploadsTotalRowCount: totalFromUploads,
      uploadsCount: (uploads ?? []).length,
    });
  }

  // Supabase 기본 max-rows 제한(보통 1000)에 맞춰 안전하게 페이지네이션.
  // (user_id, dedup_key) PK 정렬 — unique 정렬 키라 페이지 경계가 절대 안 흔들림.
  const allRows: AdRow[] = [];
  const PAGE = 1000;
  let from = 0;
  // 무한 루프 방지 안전장치
  for (let guard = 0; guard < 10000; guard++) {
    const { data, error } = await admin
      .from('ad_raw_rows')
      .select('data')
      .eq('user_id', user.id)
      .order('dedup_key', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message, fetched: allRows.length }, { status: 500 });
    }
    if (!data?.length) break;
    for (const r of data) allRows.push((r as { data: AdRow }).data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const sourceRows = unpackAdRows(allRows);
  return NextResponse.json({ uploads: uploads ?? [], rows: sourceRows, totalRows: sourceRows.length });
}

// POST: store whole source families under the legacy key; revised reports replace them.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  let body: { filename?: string; rows: Record<string, unknown>[]; replaceExisting?: boolean };
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

  const upsertRows = packAdRows(rows).map((r) => ({
    user_id: user.id,
    dedup_key: adRowKey(r),
    data: r,
    filename,
  }));

  // 내부 배치를 300 으로 줄임 — 1000 은 JSONB 무게 때문에 statement_timeout(57014) 빈발.
  // 또한 .select() 반환셋이 큰 JSONB 와 함께 돌면 더 느려지므로 제거 (정확한 inserted 카운트 포기).
  // 한 청크가 timeout 으로 잘리면 더 작은 배치로 한 번 재시도.
  let attempted = 0;
  let firstError: string | null = null;
  const tryUpsert = async (batch: typeof upsertRows) => {
    return admin
      .from('ad_raw_rows')
      // New reports contain revised attribution. Legacy cache migration must
      // remain insert-only so an old device cannot overwrite newer reports.
      .upsert(batch, { onConflict: 'user_id,dedup_key', ignoreDuplicates: body.replaceExisting !== true });
  };
  const BATCH = 300;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const batch = upsertRows.slice(i, i + BATCH);
    attempted += batch.length;
    const { error } = await tryUpsert(batch);
    if (error) {
      // 57014 = statement_timeout. 절반으로 쪼개 한 번 재시도.
      if (error.code === '57014' && batch.length > 50) {
        const half = Math.ceil(batch.length / 2);
        const a = await tryUpsert(batch.slice(0, half));
        const b = await tryUpsert(batch.slice(half));
        const err = a.error ?? b.error;
        if (err && !firstError) firstError = `${err.code ?? ''} ${err.message}`.trim();
      } else if (!firstError) {
        firstError = `${error.code ?? ''} ${error.message}`.trim();
      }
    }
  }
  // Upsert does not return a reliable newly-inserted count; report attempted families.
  const actuallyInserted = firstError ? 0 : attempted;

  // ad_uploads 이력 기록 (user_id + filename UNIQUE 로 upsert)
  await admin.from('ad_uploads').upsert({
    user_id: user.id,
    filename,
    row_count: unpackAdRows(rows).length,
    uploaded_at: new Date().toISOString(),
  }, { onConflict: 'user_id,filename' });

  // Any failed batch must keep the client retry queue intact.
  if (firstError && actuallyInserted === 0) {
    return NextResponse.json(
      { error: firstError, attempted, inserted: 0, total: rows.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    inserted: actuallyInserted, // Successfully attempted families, not newly inserted rows.
    attempted,                  // 시도한 행 수
    total: rows.length,
    ...(firstError ? { partialError: firstError } : {}),
  });
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
