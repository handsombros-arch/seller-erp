// 광고 매칭 진단: 특정 옵션ID 가 platform_skus 에 제대로 등록됐는지 +
// 광고 raw(ad_raw_rows)에서 그 캠페인의 실제 옵션ID/매출이 뭔지 직접 대조.
//
// 실행:  node scripts/diag-ad-match.mjs 94153738524 토트백 버킷백
//   (첫 인자 = 확인할 옵션ID, 나머지 = 캠페인명에 포함된 키워드들)
//
// 필요 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// env 없으면 .env.local 직접 파싱 (next 가 안 떠 있어도 동작)
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('❌ SUPABASE env 없음 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1); }

const targetId = process.argv[2] ?? '94153738524';
const keywords = process.argv.slice(3).length ? process.argv.slice(3) : ['토트백', '버킷백'];

const db = createClient(url, key, { auth: { persistSession: false } });

// ── 1) platform_skus 에 그 옵션ID 가 있나? 가격은? ──
console.log(`\n=== 1) platform_skus 에서 옵션ID '${targetId}' 조회 ===`);
const { data: ps, error: e1 } = await db
  .from('platform_skus')
  .select('platform_sku_id, price, sku_id, channel_id, platform_product_name')
  .eq('platform_sku_id', targetId);
if (e1) console.error('조회 오류', e1);
else if (!ps?.length) console.log(`  ⚠️ 없음 — 이 옵션ID 로 저장된 platform_skus 행이 0개. (쿠팡 채널 상품ID칸에 안 들어갔거나 저장 실패)`);
else for (const r of ps) {
  const priceOk = r.price != null && Number(r.price) > 0;
  console.log(`  sku_id=${r.sku_id}  channel_id=${r.channel_id}  price=${r.price ?? 'NULL'} ${priceOk ? '✅' : '❌(가격없음/0 → 매출 0)'}  name=${r.platform_product_name ?? ''}`);
}

// 혹시 공백/유사 ID 로 저장됐나 (앞뒤 공백, 부분일치)
const { data: like } = await db
  .from('platform_skus')
  .select('platform_sku_id, price, sku_id')
  .ilike('platform_sku_id', `%${targetId}%`);
const others = (like ?? []).filter((r) => String(r.platform_sku_id) !== targetId);
if (others.length) {
  console.log(`  ↪ 비슷한(공백/부분일치) 행 발견:`);
  for (const r of others) console.log(`     "[${r.platform_sku_id}]" price=${r.price ?? 'NULL'} sku_id=${r.sku_id}`);
}

// ── 2) 광고 raw 에서 해당 캠페인 행들의 실제 옵션ID/매출 ──
console.log(`\n=== 2) ad_raw_rows 에서 캠페인 [${keywords.join(', ')}] 행 스캔 ===`);
const rows = [];
let from = 0;
for (let g = 0; g < 10000; g++) {
  const { data, error } = await db.from('ad_raw_rows').select('data').order('dedup_key').range(from, from + 999);
  if (error) { console.error('raw 조회 오류', error); break; }
  if (!data?.length) break;
  for (const r of data) rows.push(r.data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`  ad_raw_rows 총 ${rows.length}행 로드`);

const hit = rows.filter((r) => {
  const camp = String(r['캠페인명'] ?? '');
  const prod = String(r['광고집행 상품명'] ?? '');
  return keywords.some((k) => camp.includes(k) || prod.includes(k));
});
console.log(`  키워드 매칭 행: ${hit.length}개`);

// 옵션ID(전환) 별 집계
const agg = new Map();
for (const r of hit) {
  const convId = String(r['광고전환매출발생 옵션ID'] ?? '');
  const runId = String(r['광고집행 옵션ID'] ?? '');
  const k = `${convId}||${runId}`;
  if (!agg.has(k)) agg.set(k, { convId, runId, camp: r['캠페인명'], orders: 0, rev: 0, rows: 0 });
  const a = agg.get(k);
  a.orders += Number(r['총 주문수(14일)']) || 0;
  a.rev += Number(r['총 전환매출액(14일)']) || 0;
  a.rows += 1;
}
console.log(`\n  [전환옵션ID] [집행옵션ID] 주문 / CSV전환매출 / 행수 / 캠페인`);
for (const a of [...agg.values()].sort((x, y) => y.orders - x.orders)) {
  const mark = a.convId === targetId ? ' ⭐(=입력한ID)' : '';
  console.log(`  ${a.convId.padEnd(13)} ${a.runId.padEnd(13)} 주문 ${String(a.orders).padStart(4)} / ${a.rev.toLocaleString().padStart(12)} / ${a.rows}행 / ${a.camp}${mark}`);
}

// ── 3) 결론 힌트 ──
console.log(`\n=== 3) 진단 ===`);
const convIds = new Set([...agg.values()].map((a) => a.convId).filter(Boolean));
if (convIds.has(targetId)) {
  console.log(`  ✅ 입력한 ID(${targetId})가 광고 raw 의 '광고전환매출발생 옵션ID' 에 존재.`);
  console.log(`     → platform_skus 에 가격이 있는지(위 1번 ✅/❌) 확인. 가격 OK 인데도 0이면 캐시(IDB/새로고침) 문제.`);
} else {
  console.log(`  ❌ 입력한 ID(${targetId})가 광고 raw 의 '광고전환매출발생 옵션ID' 에 없음!`);
  console.log(`     → 위 목록의 [전환옵션ID] 중 하나를 마스터 상품ID칸에 넣어야 함. (94153738524 는 아마 집행옵션ID)`);
}
