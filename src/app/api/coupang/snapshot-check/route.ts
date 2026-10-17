import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { buildCoupangAuth } from '@/lib/coupang/auth';
import { relayFetch } from '@/lib/api-relay';
import { sampleRows, chooseRow, saveSample, type SnapshotRow, type CheckReceipt } from '@/lib/coupang/snapshot-check';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const COOKIE = 'rg_snapshot_check';
const COOKIE_PATH = '/api/coupang/snapshot-check';
const TTL = 10 * 60 * 1000;
// Per-instance suppression only. Unique-key ignoreDuplicates is the DB safety net.
const running = new Set<string>();
function key() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || secret.length < 16) throw new Error('CONFIG_REQUIRED');
  return createHmac('sha256', secret).update('seller-erp/rg-snapshot-check/receipt/v1').digest();
}
function seal(receipt: CheckReceipt) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(receipt), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
function open(request: NextRequest, user: string): CheckReceipt | null {
  try {
    const value = request.cookies.get(COOKIE)?.value;
    if (!value || value.length > 3000) return null;
    const data = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const receipt = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as CheckReceipt;
    if (receipt.user !== user || !Number.isFinite(receipt.issued) || Date.now() < receipt.issued ||
        Date.now() - receipt.issued > TTL || receipt.row.snapshot_date !== new Date().toISOString().slice(0, 10)) return null;
    return receipt;
  } catch { return null; }
}
function reply(state: string, extra: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ state, checked_utc: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function summary(receipt: CheckReceipt) {
  return { check_id: receipt.id, snapshot_date: receipt.row.snapshot_date, max_write_rows: 1, partial_sample: true,
    provider_items_read: receipt.provider_items_read, candidates_checked: receipt.candidates_checked };
}
async function readRow(admin: Awaited<ReturnType<typeof createAdminClient>>, row: SnapshotRow) {
  const { data, error } = await admin.from('rg_inventory_snapshots')
    .select('snapshot_date,vendor_item_id,external_sku_id,total_orderable_qty,sales_last_30d')
    .eq('snapshot_date', row.snapshot_date).eq('vendor_item_id', row.vendor_item_id).maybeSingle();
  if (error) throw new Error('READ_FAILED');
  return data as SnapshotRow | null;
}
export async function GET(request: NextRequest) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply('LOGIN_REQUIRED', {}, 401);
  const receipt = open(request, user.id);
  if (!receipt) return reply('NO_ACTIVE_CHECK', {}, 404);
  try {
    const stored = await readRow(await createAdminClient(), receipt.row);
    return reply(stored ? 'INDEPENDENT_READ_PRESENT' : 'INDEPENDENT_READ_ABSENT',
      { ...summary(receipt), present: !!stored, matches_sample: !!stored &&
        stored.total_orderable_qty === receipt.row.total_orderable_qty &&
        stored.sales_last_30d === receipt.row.sales_last_30d && stored.external_sku_id === receipt.row.external_sku_id,
        can_save: !stored && !receipt.existed, provider_requests: 0, write_attempts: 0 });
  } catch { return reply('READ_FAILED', {}, 502); }
}
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply('ORIGIN_REJECTED', {}, 403);
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply('LOGIN_REQUIRED', {}, 401);
  const body = await request.json().catch(() => null);
  if (!body || !['prepare', 'save'].includes(body.action)) return reply('INVALID_ACTION', {}, 400);
  if (running.has(user.id)) return reply('CHECK_BUSY', {}, 409);
  const receipt = open(request, user.id);
  if (body.action === 'prepare' && receipt) return reply('CHECK_ALREADY_PREPARED', summary(receipt), 409);
  if (body.action === 'save' && !receipt) return reply('PREPARE_REQUIRED', {}, 409);
  running.add(user.id);
  try {
    const admin = await createAdminClient();
    if (body.action === 'save' && receipt) {
      const result = await saveSample(receipt, async row => {
        const { data, error } = await admin.from('rg_inventory_snapshots')
          .upsert([row], { onConflict: 'snapshot_date,vendor_item_id', ignoreDuplicates: true }).select('id');
        return { inserted: data?.length ?? 0, uncertain: !!error };
      }, row => readRow(admin, row));
      return reply(result.state, { ...summary(receipt), ...result, provider_requests: 0,
        write_attempts: receipt.existed ? 0 : 1 });
    }
    if (!['https://15.165.83.123', 'https://15.165.83.123/'].includes(process.env.COUPANG_PROXY_URL ?? '')) {
      return reply('AWS_RELAY_CONFIG_REQUIRED', {}, 503);
    }
    // Ensure receipt encryption is available before any upstream request.
    key();
    const { data: cred, error } = await admin.from('coupang_credentials')
      .select('access_key,secret_key,vendor_id').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !cred) return reply('CREDENTIALS_UNAVAILABLE', {}, 503);
    if (!/^\w+$/.test(cred.vendor_id)) return reply('CREDENTIALS_UNAVAILABLE', {}, 503);
    const target = `/v2/providers/rg_open_api/apis/api/v1/vendors/${cred.vendor_id}/rg/inventory/summaries`;
    const signed = buildCoupangAuth('GET', target, {}, { accessKey: cred.access_key, secretKey: cred.secret_key, vendorId: cred.vendor_id });
    let response: Response;
    try { response = await relayFetch(signed.url, { method: 'GET', cache: 'no-store',
      headers: { Authorization: signed.authorization, 'X-Requested-By': cred.vendor_id,
        'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000) }); }
    catch { return reply('PROVIDER_REQUEST_FAILED', { provider_requests: 1, write_attempts: 0 }, 502); }
    if (!response.ok) { if (response.body) await response.body.cancel();
      return reply('PROVIDER_HTTP_FAILED', { provider_requests: 1, provider_http_status: response.status, write_attempts: 0 }, 502); }
    let rows: SnapshotRow[], providerItemsRead = 0;
    try { const payload = await response.json(); providerItemsRead = Array.isArray(payload?.data) ? payload.data.length : 0;
      rows = sampleRows(payload, new Date().toISOString().slice(0, 10)); }
    catch { return reply('PROVIDER_RESPONSE_INVALID', { provider_requests: 1, write_attempts: 0 }, 502); }
    if (!rows.length) return reply('EMPTY_PROVIDER_PAGE', { provider_requests: 1, provider_http_status: response.status, write_attempts: 0 });
    const existing = await admin.from('rg_inventory_snapshots').select('vendor_item_id')
      .eq('snapshot_date', rows[0].snapshot_date).in('vendor_item_id', rows.map(row => row.vendor_item_id));
    if (existing.error) return reply('READ_FAILED', { provider_requests: 1, write_attempts: 0 }, 502);
    const selected = chooseRow(rows, (existing.data ?? []).map(row => row.vendor_item_id))!;
    const next: CheckReceipt = { user: user.id, id: randomUUID(), issued: Date.now(), ...selected,
      provider_items_read: providerItemsRead, candidates_checked: rows.length };
    const result = reply(selected.existed ? 'ALREADY_PRESENT' : 'READY_TO_SAVE', {
      ...summary(next), provider_requests: 1, provider_http_status: response.status, write_attempts: 0,
      can_save: !selected.existed, candidates_checked: rows.length, receipt_expires_utc: new Date(next.issued + TTL).toISOString() });
    result.cookies.set(COOKIE, seal(next), { httpOnly: true, secure: true, sameSite: 'strict', path: COOKIE_PATH, maxAge: TTL / 1000 });
    return result;
  } catch { return reply('CHECK_FAILED', {}, 502); }
  finally { running.delete(user.id); }
}
