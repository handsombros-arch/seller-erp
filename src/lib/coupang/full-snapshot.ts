import { createHash, createHmac } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { buildCoupangAuth } from './auth';
import { relayFetch } from '@/lib/api-relay';

export type VerificationItem = { id: string; external_id: string | null; quantity: number; sales_30d: number };
type Raw = Record<string, unknown>;
const rpcNames = new Set(['rg_verify_claim','rg_verify_stage','rg_verify_finish','rg_verify_fail','rg_verify_status']);
const safeFields = ['run_id','state','error_code','trigger_kind','started_utc','finished_utc','snapshot_date',
  'pages','rows','content_hash','lease_expired','independent_rows','matches','schedule_pinned'];
export function publicResult(raw: Raw): Raw {
  return Object.fromEntries(safeFields.filter(k => Object.prototype.hasOwnProperty.call(raw, k)).map(k => [k, raw[k]]));
}
export function contentHash(items: VerificationItem[]) {
  const canonical = [...items].sort((a,b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
    .map(r => `${Buffer.byteLength(r.id)}:${r.id}|${r.external_id === null ? '-1:' : Buffer.byteLength(r.external_id)+':'+r.external_id}|${r.quantity}|${r.sales_30d}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}
export function parsePage(value: unknown): { items: VerificationItem[]; next: string | null } {
  const json = value as { code?: unknown; data?: unknown; nextToken?: unknown };
  if (!json || (json.code != null && String(json.code) !== '200') || !Array.isArray(json.data) || json.data.length > 1000) throw new Error('INVALID_PAGE');
  const items = json.data.map(item => {
    const id = String(item?.vendorItemId ?? ''), quantity = item?.inventoryDetails?.totalOrderableQuantity;
    const sales = item?.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS ?? 0;
    const external = item?.externalSkuId == null ? null : String(item.externalSkuId);
    if (!/^\d{1,32}$/.test(id) || !Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(sales) || sales < 0 ||
        (external !== null && external.length > 128)) throw new Error('INVALID_ITEM');
    return { id, external_id: external, quantity, sales_30d: sales };
  });
  const next = json.nextToken == null || json.nextToken === '' ? null : json.nextToken;
  if (next !== null && (typeof next !== 'string' || next.length > 4096)) throw new Error('INVALID_CURSOR');
  return { items, next };
}
async function call(name: string, args: Record<string, unknown>): Promise<Raw> {
  if (!rpcNames.has(name)) throw new Error('RPC_REJECTED');
  const admin = await createAdminClient();
  const { data, error } = await admin.rpc(name, args).abortSignal(AbortSignal.timeout(4000));
  if (error || !data || typeof data !== 'object') throw new Error('VERIFICATION_DB_UNAVAILABLE');
  return data as Raw;
}
export async function readFullVerification(requestKey: string, actor: string | null) {
  return publicResult(await call('rg_verify_status', { p_request_key: requestKey, p_actor: actor }));
}
export async function collectAllPages(deps: {
  claim: () => Promise<Raw>; stage: (run: Raw, cursor: string, next: string | null, items: VerificationItem[]) => Promise<Raw>;
  finish: (run: Raw, hash: string) => Promise<Raw>; fail: (run: Raw, code: string) => Promise<Raw>;
  status: () => Promise<Raw>; fetchPage: (cursor: string) => Promise<{ ok: boolean; json: () => Promise<unknown>; discard: () => Promise<void> }>;
  now?: () => number;
}): Promise<Raw> {
  const now = deps.now ?? Date.now, started = now();
  const run = await deps.claim();
  if (!run.claimed) return publicResult(run);
  let cursor = '', pages = 0;
  const seen = new Set<string>(), items = new Map<string, VerificationItem>();
  const failure = async (code: string) => publicResult(await deps.fail(run, code));
  const uncertain = async () => {
    try { const status = await deps.status();
      if (status.state === 'COMPLETE' && status.matches === true) return publicResult(status);
      return { ...publicResult(status), state: 'WRITE_UNCERTAIN', error_code: 'STATE_WRITE_UNCERTAIN' };
    } catch { return { run_id: run.run_id, state: 'WRITE_UNCERTAIN', error_code: 'STATE_READ_FAILED' }; }
  };
  while (true) {
    if (now() - started > 10000) { try { return await failure('BUDGET_LIMIT'); } catch { return uncertain(); } }
    if (pages >= 50) { try { return await failure('PAGE_LIMIT'); } catch { return uncertain(); } }
    if (seen.has(cursor)) { try { return await failure('CURSOR_REPEAT'); } catch { return uncertain(); } }
    seen.add(cursor);
    let response;
    try { response = await deps.fetchPage(cursor); }
    catch { try { return await failure('PROVIDER_NETWORK'); } catch { return uncertain(); } }
    if (!response.ok) { try { await response.discard(); } catch {}
      try { return await failure('PROVIDER_HTTP'); } catch { return uncertain(); } }
    let page;
    try { page = parsePage(await response.json()); }
    catch { try { return await failure('PROVIDER_INVALID'); } catch { return uncertain(); } }
    for (const item of page.items) items.set(item.id, item);
    if (items.size > 1000) { try { return await failure('ROW_LIMIT'); } catch { return uncertain(); } }
    let staged;
    try { staged = await deps.stage(run, cursor, page.next, page.items); }
    catch { return uncertain(); }
    if (staged.state !== 'READING') return publicResult(staged);
    pages++;
    if (page.next === null) break;
    cursor = page.next;
  }
  try { return publicResult(await deps.finish(run, contentHash([...items.values()]))); }
  catch { return uncertain(); }
}
export async function runFullVerification(actor: string | null, requestKey: string, trigger: 'manual' | 'scheduled') {
  if (!['https://15.165.83.123','https://15.165.83.123/'].includes(process.env.COUPANG_PROXY_URL ?? '')) return { state: 'BLOCKED', error_code: 'AWS_RELAY_CONFIG_REQUIRED' };
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return { state: 'BLOCKED', error_code: 'CONFIG_REQUIRED' };
  const admin = await createAdminClient();
  const { data: cred, error } = await admin.from('coupang_credentials').select('access_key,secret_key,vendor_id')
    .order('updated_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(4000)).maybeSingle();
  if (error || !cred || !/^\w+$/.test(cred.vendor_id)) return { state: 'BLOCKED', error_code: 'CREDENTIALS_UNAVAILABLE' };
  const account = createHmac('sha256', secret).update('rg-full-snapshot-v1/'+cred.vendor_id).digest('hex');
  const args = (run: Raw) => ({ p_run: run.run_id, p_lease: run.lease_token });
  return collectAllPages({
    claim: () => call('rg_verify_claim', { p_account_key: account, p_request_key: requestKey, p_actor: actor, p_trigger: trigger }),
    stage: (run,cursor,next,items) => call('rg_verify_stage', { ...args(run), p_cursor: cursor, p_next: next, p_items: items }),
    finish: (run,hash) => call('rg_verify_finish', { ...args(run), p_expected_hash: hash }),
    fail: (run,code) => call('rg_verify_fail', { ...args(run), p_code: code }),
    status: () => call('rg_verify_status', { p_request_key: requestKey, p_actor: actor }),
    fetchPage: async cursor => {
      const path = `/v2/providers/rg_open_api/apis/api/v1/vendors/${cred.vendor_id}/rg/inventory/summaries`;
      const signed = buildCoupangAuth('GET', path, cursor ? { nextToken: cursor } : {},
        { accessKey: cred.access_key, secretKey: cred.secret_key, vendorId: cred.vendor_id });
      const response = await relayFetch(signed.url, { method: 'GET', cache: 'no-store',
        headers: { Authorization: signed.authorization, 'X-Requested-By': cred.vendor_id, 'Content-Type': 'application/json;charset=UTF-8' },
        signal: AbortSignal.timeout(5000) });
      return { ok: response.ok, json: () => response.json(), discard: async () => { if (response.body) await response.body.cancel(); } };
    },
  });
}
