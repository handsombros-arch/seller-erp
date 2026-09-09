import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * 광고 보고서 원본 파일 백업 (Supabase Storage 'ad-files', 경로 <user_id>/<timestamp>_<파일명>)
 *  GET                → 내 백업 파일 목록
 *  GET ?download=path → 다운로드용 서명 URL (2분)
 *  POST { filename }  → 직접 업로드용 서명 토큰 (파일은 브라우저 → Storage 로 바로 올림, Vercel 4.5MB 제한 무관)
 *  DELETE ?path=      → 삭제
 * 새 PC 에서는 이 파일들을 내려받아 브라우저에서 다시 파싱하면 광고 분석 데이터가 그대로 복원된다.
 */
const BUCKET = 'ad-files';

async function ensureBucket(admin: any) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 209715200 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  await ensureBucket(admin);
  const dl = request.nextUrl.searchParams.get('download');
  if (dl) {
    if (!dl.startsWith(`${user.id}/`)) return NextResponse.json({ error: '권한 없음' }, { status: 403 });
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(dl, 120);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ url: data.signedUrl });
  }
  const { data, error } = await admin.storage.from(BUCKET).list(user.id, { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return NextResponse.json({ error: error.message, files: [] }, { status: 200 });
  const files = (data ?? []).filter((f: any) => f.name && !f.name.startsWith('.')).map((f: any) => ({
    path: `${user.id}/${f.name}`,
    name: f.name.replace(/^\d{13}_/, ''),
    size: f.metadata?.size ?? null,
    created_at: f.created_at ?? null,
  }));
  return NextResponse.json({ files });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const { filename } = await request.json().catch(() => ({}));
  if (!filename) return NextResponse.json({ error: 'filename 필요' }, { status: 400 });
  const admin = await createAdminClient();
  await ensureBucket(admin);
  const safe = String(filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  const path = `${user.id}/${Date.now()}_${safe}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ path, token: data.token, bucket: BUCKET });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith(`${user.id}/`)) return NextResponse.json({ error: '권한 없음' }, { status: 403 });
  const admin = await createAdminClient();
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
