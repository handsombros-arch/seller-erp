import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

interface ParsedRow {
  date: string;
  vendorItemId: string;
  name: string;
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  qty14d: number;
  rev14d: number;
}

interface GroupedAd {
  vendorItemId: string;
  name: string;
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  qty14d: number;
  rev14d: number;
  skuId: string | null;
  matched: boolean;
}

/** 쿠팡 PA(상품 광고) daily vendorItem 엑셀 파싱 */
function parseCoupangPA(wb: XLSX.WorkBook): ParsedRow[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
  return rows.map(r => ({
    date: String(r['날짜'] ?? ''),
    vendorItemId: String(r['광고집행 옵션ID'] ?? ''),
    name: String(r['광고집행 상품명'] ?? ''),
    campaignId: String(r['캠페인 ID'] ?? ''),
    // 쿠팡 PA export 양식 변경(2026-06): '캠페인명' → '캠페인'. 둘 다 지원.
    campaignName: String(r['캠페인명'] ?? r['캠페인'] ?? ''),
    cost: Number(r['광고비']) || 0,
    impressions: Number(r['노출수']) || 0,
    clicks: Number(r['클릭수']) || 0,
    qty14d: Number(r['총 판매수량(14일)']) || 0,
    rev14d: Number(r['총 전환매출액(14일)']) || 0,
  }));
}

/** 쿠팡 NCA(신규 구매 고객 확보) daily 엑셀 파싱 */
function parseCoupangNCA(wb: XLSX.WorkBook): ParsedRow[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
  return rows.map(r => ({
    date: String(r['날짜'] ?? ''),
    vendorItemId: String(r['광고집행 옵션 ID'] ?? r['광고집행 옵션ID'] ?? ''),
    name: String(r['광고집행 상품명'] ?? ''),
    campaignId: String(r['캠페인 ID'] ?? ''),
    campaignName: String(r['캠페인 이름'] ?? r['캠페인명'] ?? ''),
    cost: Number(r['집행 광고비']) || 0,
    impressions: Number(r['노출수']) || 0,
    clicks: Number(r['클릭수']) || 0,
    qty14d: 0,
    rev14d: Number(r['첫구매를 통한 광고 전환 매출']) || 0,
  }));
}

/** 헤더로 PA/NCA 자동 감지 */
function detectAdType(wb: XLSX.WorkBook): 'pa' | 'nca' | null {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  const header = (raw[0] || []) as string[];
  if (header.includes('집행 광고비') || header.includes('신규 구매 고객 수')) return 'nca';
  if (header.includes('광고비') && header.includes('광고집행 옵션ID')) return 'pa';
  return null;
}

/** YYYYMMDD 또는 YYYY.MM.DD → YYYY-MM */
function dateToYm(s: string): string {
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  return '';
}

// ──────────────────────────────────────────────────────────
// POST: 엑셀 파싱 + 미리보기 (DB 저장 X)
// ──────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const platform = (formData.get('platform') as string) || 'coupang';
  const adTypeHint = formData.get('ad_type') as string | null;
  const yearMonthHint = formData.get('year_month') as string | null;

  if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf);

  // 광고 유형 결정
  const adType = (adTypeHint as 'pa' | 'nca' | null) || detectAdType(wb);
  if (!adType) {
    return NextResponse.json({ error: '광고 유형 감지 실패. 헤더 확인 필요.' }, { status: 400 });
  }

  // 파싱
  const parsed = adType === 'nca' ? parseCoupangNCA(wb) : parseCoupangPA(wb);

  // 연월: 엑셀 첫 행 날짜 우선 자동 감지 → 없으면 hint 사용
  const detected = parsed.length > 0 ? dateToYm(parsed[0].date) : '';
  const yearMonth = detected || yearMonthHint || '';
  if (!yearMonth) {
    return NextResponse.json({ error: '연월 추출 실패 — 엑셀 날짜 또는 year_month 파라미터 필요' }, { status: 400 });
  }

  // vendor_item_id 기준 집계 (캠페인은 첫 값 사용 — 같은 옵션ID에 여러 캠페인 있으면 마지막만)
  const grouped = new Map<string, GroupedAd>();
  for (const r of parsed) {
    if (!r.vendorItemId) continue;
    const key = `${r.vendorItemId}||${r.campaignId}`;
    const prev = grouped.get(key) || {
      vendorItemId: r.vendorItemId,
      name: r.name,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      cost: 0, impressions: 0, clicks: 0, qty14d: 0, rev14d: 0,
      skuId: null, matched: false,
    };
    prev.cost += r.cost;
    prev.impressions += r.impressions;
    prev.clicks += r.clicks;
    prev.qty14d += r.qty14d;
    prev.rev14d += r.rev14d;
    if (!prev.name && r.name) prev.name = r.name;
    grouped.set(key, prev);
  }

  // SKU 매핑 (rg + platform_skus → sku_id)
  const { data: rg } = await admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id');
  const { data: ps } = await admin.from('platform_skus').select('platform_sku_id, sku_id');
  const rgMap = new Map((rg ?? []).map((r: any) => [String(r.vendor_item_id), r.sku_id]));
  const psMap = new Map((ps ?? []).filter((p: any) => p.platform_sku_id).map((p: any) => [String(p.platform_sku_id), p.sku_id]));

  for (const g of grouped.values()) {
    const skuId = rgMap.get(g.vendorItemId) || psMap.get(g.vendorItemId) || null;
    g.skuId = skuId as string | null;
    g.matched = !!skuId;
  }

  const products = [...grouped.values()].sort((a, b) => b.cost - a.cost);

  return NextResponse.json({
    yearMonth,
    platform,
    adType,
    totalCost: products.reduce((s, p) => s + p.cost, 0),
    totalImpressions: products.reduce((s, p) => s + p.impressions, 0),
    totalClicks: products.reduce((s, p) => s + p.clicks, 0),
    matchedItems: products.filter(p => p.matched).length,
    totalItems: products.length,
    products,
  });
}

// ──────────────────────────────────────────────────────────
// PUT: 미리보기 결과를 DB에 저장 (upsert)
// ──────────────────────────────────────────────────────────
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json() as {
    yearMonth: string;
    platform: string;
    adType: string;
    products: GroupedAd[];
    overrides?: Record<string, string | null>;  // vendorItemId|campaignId → sku_id (수동 매핑)
    resolveSku?: boolean;                       // true 면 skuId 가 없는 행을 서버에서 옵션ID→sku 매핑
  };

  if (!body.yearMonth || !body.platform || !body.adType || !Array.isArray(body.products)) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 });
  }

  const admin = await createAdminClient();
  const overrides = body.overrides || {};

  if (body.resolveSku) {
    const [{ data: rg }, { data: ps }] = await Promise.all([
      admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id'),
      admin.from('platform_skus').select('platform_sku_id, sku_id'),
    ]);
    const rgMap = new Map((rg ?? []).map((r: any) => [String(r.vendor_item_id), r.sku_id as string]));
    const psMap = new Map((ps ?? []).filter((p: any) => p.platform_sku_id).map((p: any) => [String(p.platform_sku_id), p.sku_id as string]));
    for (const p of body.products) {
      if (!p.skuId) p.skuId = (rgMap.get(String(p.vendorItemId)) || psMap.get(String(p.vendorItemId)) || null) as string | null;
    }
  }

  const rows = body.products.map(p => {
    const key = `${p.vendorItemId}||${p.campaignId}`;
    const overrideSku = overrides[key];
    return {
      user_id: user.id,
      year_month: body.yearMonth,
      platform: body.platform,
      ad_type: body.adType,
      vendor_item_id: p.vendorItemId || null,
      sku_id: overrideSku !== undefined ? overrideSku : p.skuId,
      campaign_id: p.campaignId || null,
      campaign_name: p.campaignName || null,
      name: p.name || null,
      cost: p.cost,
      impressions: p.impressions,
      clicks: p.clicks,
      conv_qty_14d: p.qty14d,
      conv_rev_14d: p.rev14d,
      updated_at: new Date().toISOString(),
    };
  });

  // 같은 (user_id, year_month, platform, ad_type) 의 이전 데이터 전부 삭제 후 재삽입
  // — 같은 ad_type 재업로드 시 깨끗하게 교체 (다른 ad_type 은 보존되므로 PA/NCA 누적 가능)
  await admin.from('monthly_product_ads').delete()
    .eq('user_id', user.id)
    .eq('year_month', body.yearMonth)
    .eq('platform', body.platform)
    .eq('ad_type', body.adType);

  if (rows.length > 0) {
    const { error } = await admin.from('monthly_product_ads').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}

// ──────────────────────────────────────────────────────────
// GET: 저장된 월별 광고비 조회
// ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('year_month');
  const platform = searchParams.get('platform');

  const admin = await createAdminClient();
  let q = admin.from('monthly_product_ads')
    .select('*, sku:skus(id, sku_code, cost_price, product:products(id, name, logistics_tier))')
    .eq('user_id', user.id);
  if (yearMonth) q = q.eq('year_month', yearMonth);
  if (platform) q = q.eq('platform', platform);

  const { data, error } = await q.order('cost', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ──────────────────────────────────────────────────────────
// DELETE: 특정 월/플랫폼/광고유형 전체 삭제 (재업로드 전)
// ──────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('year_month');
  const platform = searchParams.get('platform');
  const adType = searchParams.get('ad_type');

  if (!yearMonth || !platform) {
    return NextResponse.json({ error: 'year_month + platform 필수' }, { status: 400 });
  }

  const admin = await createAdminClient();
  let q = admin.from('monthly_product_ads').delete()
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .eq('platform', platform);
  if (adType) q = q.eq('ad_type', adType);

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
