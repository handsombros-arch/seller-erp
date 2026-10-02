const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => dependencies[name] ?? require(name), Buffer, console });
  return exports;
}

const sync = load('src/lib/ad-analysis/sync.ts');
const { mergeAdRows, packAdRows, unpackAdRows } = sync;
const row = (date, revenue) => ({ '날짜': date, '키워드': 'test', '총 전환매출액(14일)': revenue });
const old = row('2026-10-01', 10), revised = row('2026-10-01', 20), pending = row('2026-10-01', 30);
assert.equal(mergeAdRows([], [revised], []).length, 1, 'fresh device loads server history');
assert.equal(mergeAdRows([old], [revised], [])[0]['총 전환매출액(14일)'], 20, 'same-count corrections replace stale cache');
assert.equal(mergeAdRows([old], [revised], [pending])[0]['총 전환매출액(14일)'], 30, 'unsaved report remains visible');
assert.equal(mergeAdRows([old, row('2026-09-01', 5)], [revised], []).length, 2, 'local-only history is retained');
assert.equal(mergeAdRows([old], [old], [old]).length, 1, 'retries do not duplicate rows');

// Multiple legitimate observations can share all legacy dimensions.
const family = [row('2026-10-01', 10), row('2026-10-01', 20)];
assert.equal(mergeAdRows([], family, []).length, 2, 'preserve source collisions');
assert.equal(mergeAdRows(family, family, family).length, 2, 'repeat uploads replace families');
assert.equal(mergeAdRows([old], family, []).length, 2, 'repair legacy first-row loss');
assert.equal(mergeAdRows(family, [revised], []).length, 1, 'corrected family may shrink');
assert.equal(unpackAdRows(packAdRows(family)).length, 2, 'storage round trip preserves rows');
assert.equal(unpackAdRows(packAdRows([old, old])).length, 2, 'identical source observations are retained');
const packed = packAdRows([...Array.from({length: 2000}, (_, i) => row(String(i), 1)), ...family]);
const roundTrip = packed.slice(0, 2000).concat(packed.slice(2000));
assert.equal(unpackAdRows(roundTrip).length, 2002, 'chunking does not split a family');

// Optional real source report supplied locally; never checked into the repository.
let sourceReport;
if (process.argv[2]) {
  const xlsx = require('xlsx');
  const wb = xlsx.readFile(process.argv[2]);
  const source = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  sourceReport = source;
  const restored = unpackAdRows(packAdRows(source));
  const repeated = mergeAdRows(restored, source, []);
  assert.equal(source.length, 4117);
  assert.equal(restored.length, source.length);
  assert.equal(repeated.length, source.length);
  for (const column of ['노출수', '클릭수', '광고비', '총 주문수(14일)', '총 전환매출액(14일)']) {
    const sum = rows => rows.reduce((total, r) => total + Number(r[column] || 0), 0);
    assert.equal(sum(restored), sum(source), column + ' storage total');
    assert.equal(sum(repeated), sum(source), column + ' reupload total');
    console.log(column, sum(source));
  }
  console.log('PASS: real report retains all 4,117 rows through storage and reupload');
}

const writes = [];
let fail = false;
let storedRows = [];
const admin = { from: table => ({ select() { return this; }, eq() { return this; },
  order() { return table === 'ad_uploads' ? Promise.resolve({ data: [] }) : this; },
  async range(from, to) { return { data: storedRows.slice(from, to + 1), count: storedRows.length }; }, upsert: async (rows, options) => {
  writes.push({ table, rows, options });
  return { error: fail && table === 'ad_raw_rows' ? { code: 'TEST', message: 'offline' } : null };
} }) };
const api = load('src/app/api/ad-analysis/rows/route.ts', {
  '@/lib/ad-analysis/sync': sync,
  'next/server': { NextResponse: { json: (body, opts) => ({ body, status: opts?.status ?? 200 }) } },
  '@/lib/supabase/server': {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) } }),
    createAdminClient: async () => admin,
  },
});
const request = body => ({ headers: new Headers(), json: async () => body });
(async () => {
  await api.POST(request({ rows: [old] }));
  assert.equal(writes[0].options.ignoreDuplicates, true, 'legacy migration cannot overwrite cloud data');
  assert.equal(writes[0].rows[0].user_id, 'test-user', 'writes remain scoped to authenticated account');
  writes.length = 0;
  await api.POST(request({ rows: [revised], replaceExisting: true }));
  assert.equal(writes[0].options.ignoreDuplicates, false, 'new reports update attribution');
  writes.length = 0;
  await api.POST(request({ rows: packAdRows(family), replaceExisting: true }));
  const saved = writes[0].rows;
  assert.equal(saved.length, 1, 'one atomic database write per legacy family');
  assert.equal(unpackAdRows(saved.map(r => r.data)).length, 2, 'API stores every source member');
  assert.equal(saved[0].dedup_key, sync.adRowKey(old), 'repair reuses legacy database key');
  storedRows = saved;
  let loaded = await api.GET({ nextUrl: new URL('https://example.test/api/ad-analysis/rows') });
  assert.equal(loaded.body.rows.length, 2, 'GET expands stored source families');
  if (sourceReport) {
    writes.length = 0;
    await api.POST(request({ rows: packAdRows(sourceReport), replaceExisting: true }));
    storedRows = writes.filter(w => w.table === 'ad_raw_rows').flatMap(w => w.rows);
    loaded = await api.GET({ nextUrl: new URL('https://example.test/api/ad-analysis/rows') });
    assert.equal(loaded.body.totalRows, 4117, 'GET pages and expands entire real report');
    assert.equal(loaded.body.rows.reduce((n, r) => n + Number(r['광고비'] || 0), 0), 243061);
    const paged = await sync.fetchAdHistory(async page => {
      const response = await api.GET({ nextUrl: new URL('https://example.test/api/ad-analysis/rows?page=' + page) });
      assert.equal(response.status, 200);return response.body;
    });
    assert.equal(paged.length, 4117);
    assert.equal(paged.reduce((n,r)=>n+Number(r['광고비']||0),0),243061);
    await assert.rejects(sync.fetchAdHistory(async page=>{if(page===2)throw Error('offline');return {rows:[],storedCount:2000,pageSize:500};}),/offline/);
    console.log('PASS: bounded parallel server pages preserve entire real report and reject partial failure');
  }
  fail = true;
  const result = await api.POST(request({ rows: [pending], replaceExisting: true }));
  assert.equal(result.status, 500, 'failed persistence cannot appear successful');
  console.log('PASS: ad sync regression checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
