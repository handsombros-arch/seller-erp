import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runFullVerification, readFullVerification } from '@/lib/coupang/full-snapshot';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function reply(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ checked_utc: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, ...data },
    { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply({ state: 'BLOCKED', error_code: 'ORIGIN_REJECTED' }, 403);
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return reply({ state: 'BLOCKED', error_code: 'LOGIN_REQUIRED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.request_id ?? '')) return reply({ state: 'BLOCKED', error_code: 'INVALID_REQUEST_ID' }, 400);
  try { return reply(await runFullVerification(user.id, 'manual:'+body.request_id, 'manual')); }
  catch { return reply({ state: 'WRITE_UNCERTAIN', error_code: 'USE_INDEPENDENT_READ' }, 502); }
}
export async function GET(request: NextRequest) {
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return reply({ state: 'BLOCKED', error_code: 'LOGIN_REQUIRED' }, 401);
  const id = request.nextUrl.searchParams.get('request_id'), date = request.nextUrl.searchParams.get('scheduled_date');
  const key = id && validId(id) ? 'manual:'+id : date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'scheduled:'+date : null;
  if (!key) return reply({ state: 'BLOCKED', error_code: 'REQUEST_ID_REQUIRED' }, 400);
  try { return reply(await readFullVerification(key, user.id)); }
  catch { return reply({ state: 'READ_UNCERTAIN', error_code: 'VERIFICATION_DB_UNAVAILABLE' }, 502); }
}
