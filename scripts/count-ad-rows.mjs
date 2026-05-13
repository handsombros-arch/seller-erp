import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE env missing');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { count: rawCount, error: e1 } = await supabase
  .from('ad_raw_rows')
  .select('*', { count: 'exact', head: true });

if (e1) { console.error('count error', e1); process.exit(1); }

const { data: byUser, error: e2 } = await supabase
  .from('ad_raw_rows')
  .select('user_id', { count: 'exact' })
  .limit(0);

const { data: uploads, error: e3 } = await supabase
  .from('ad_uploads')
  .select('user_id, filename, row_count, uploaded_at')
  .order('uploaded_at', { ascending: false })
  .limit(20);

console.log('=== ad_raw_rows 전체 행 수 ===');
console.log(rawCount?.toLocaleString());

console.log('\n=== 최근 20개 업로드 (ad_uploads) ===');
if (uploads) {
  for (const u of uploads) {
    console.log(`${u.uploaded_at}  ${String(u.row_count).padStart(7)} rows  ${u.filename}`);
  }
}
