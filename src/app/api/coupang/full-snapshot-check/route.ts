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
async function authenticate() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => { const client = await createClient(); return client.auth.getUser(); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AUTH_DEADLINE')), 4000); }),
    ]);
    const { data: { user }, error } = result;
    if (user && !error) return { user, response: null };
    const unavailable = error && error.name !== 'AuthSessionMissingError' && ![400,401,403].includes(error.status ?? 0);
    return { user: null, response: reply({ state: 'BLOCKED', error_code: unavailable ? 'AUTH_UNAVAILABLE' : 'LOGIN_REQUIRED' }, unavailable ? 503 : 401) };
  } catch {
    return { user: null, response: reply({ state: 'BLOCKED', error_code: 'AUTH_UNAVAILABLE' }, 503) };
  } finally { if (timer) clearTimeout(timer); }
}
export async function POST(request: NextRequest) {
  const deadline = Date.now() + 22000;
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply({ state: 'BLOCKED', error_code: 'ORIGIN_REJECTED' }, 403);
  const { user, response } = await authenticate();
  if (!user) return response!;
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.request_id ?? '')) return reply({ state: 'BLOCKED', error_code: 'INVALID_REQUEST_ID' }, 400);
  try {
    const result = await runFullVerification(user.id, 'manual:'+body.request_id, 'manual', deadline);
    console.info(JSON.stringify({ event: 'RG_VERIFICATION_MANUAL', checked_utc: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, request_id: body.request_id, ...result }));
    return reply(result);
  }
  catch { return reply({ state: 'WRITE_UNCERTAIN', error_code: 'USE_INDEPENDENT_READ' }, 502); }
}
export async function GET(request: NextRequest) {
  const { user, response } = await authenticate();
  if (!user) return response!;
  const id = request.nextUrl.searchParams.get('request_id'), date = request.nextUrl.searchParams.get('scheduled_date');
  const key = id && validId(id) ? 'manual:'+id : date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'scheduled:'+date : null;
  if (!key) return reply({ state: 'BLOCKED', error_code: 'REQUEST_ID_REQUIRED' }, 400);
  try { return reply(await readFullVerification(key, user.id)); }
  catch { return reply({ state: 'READ_UNCERTAIN', error_code: 'VERIFICATION_DB_UNAVAILABLE' }, 502); }
}
