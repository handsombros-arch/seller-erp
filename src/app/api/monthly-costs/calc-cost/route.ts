import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';
import * as officeCrypto from 'officecrypto-tool';

// 상품명 키워드 → DB 상품명 매핑
const NAME_MAP: Record<string, string> = {
  '오리발': '오리발 PP',
  '여자 백팩': '여성백팩',
  '프라다 원단 여성': '여성백팩',
  '호보백': '호보백',
  '골프 파우치': '골프파우치',
  '오십견': '오십견',
  '자세 교정': '자세교정밴드',
  '허리통증 교정': '자세교정밴드',
  '여행용 17인치 노트북 백팩': '하드백팩',
  '캐리어형 여행 백팩': '하드백팩',
  '대용량 여행용 노트북 남자': '확장형백팩',
  '사우스웨스트 초경량': 'SW001',
  '경량 17인치 노트북 백팩': 'SW001',
  '초경량 17인치 노트북 백팩 002': 'SW002',
  '초경량 17인치 노트북백팩': 'SW001',
  '17인치 노트북 백팩': 'SW001',
  '14인치 노트북 서류': '14서류가방',
  '더플백': '더플백',
  '보스턴': '더플백',
};

interface SoldRow {
  name: string;
  option: string;
  qty: number;
  revenue: number;
  vendorId?: string;
  productId?: string;     // 스마트스토어 상품번호 (platform_skus.platform_product_id)
  revenueMissing?: boolean; // 파일에 금액 컬럼이 없음 → 마스터 판매가로 추정
  date?: string | number;  // YYYYMMDD, YYYY-MM-DD, 또는 Excel serial
}

/** 다양한 날짜 형식 → YYYY-MM */
function toYearMonth(v: string | number | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  // Excel serial number
  if (typeof v === 'number' && v > 25569 && v < 99999) {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const digits = String(v).replace(/\D/g, '');
  if (digits.length >= 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  return '';
}

/** 일반 날짜 컬럼 후보들에서 첫 매칭 값 추출 */
function pickDateField(row: Record<string, any>): string | number | undefined {
  const candidates = ['결제일자', '결제일', '주문일자', '주문일시', '주문일', '발주일', '판매일'];
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  return undefined;
}

/** 쿠팡 인사이트 엑셀 파싱 */
function parseCoupang(wb: XLSX.WorkBook): SoldRow[] {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
  return rows
    .filter(r => Number(r['판매량']) > 0)
    .map(r => ({
      name: r['상품명'] ?? '',
      option: r['옵션명'] ?? '',
      qty: Number(r['판매량']),
      revenue: Number(r['매출(원)'] ?? 0),
      vendorId: String(r['옵션 ID'] ?? ''),
    }));
}

/** 토스 주문 엑셀 파싱 (구매확정만) */
function parseToss(wb: XLSX.WorkBook): SoldRow[] {
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
  // 헤더 행 찾기 (주문상태 포함)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i]?.some((c: any) => c === '주문상태')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const headers = raw[headerIdx] as string[];
  const colIdx = (name: string) => headers.indexOf(name);
  const iStatus = colIdx('주문상태');
  const iName = colIdx('상품명');
  const iOption = colIdx('옵션명');
  const iQty = colIdx('주문건수');
  const iAmount = colIdx('주문금액');
  // 날짜 컬럼 인덱스 (후보 중 첫 매칭)
  const dateCandidates = ['결제일자', '결제일', '주문일자', '주문일시'];
  const iDate = dateCandidates.map(c => colIdx(c)).find(i => i >= 0) ?? -1;

  const results: SoldRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row[iStatus] !== '구매확정') continue;
    results.push({
      name: String(row[iName] ?? ''),
      option: String(row[iOption] ?? ''),
      qty: Number(row[iQty]) || 1,
      revenue: Number(row[iAmount]) || 0,
      date: iDate >= 0 ? row[iDate] : undefined,
    });
  }
  return results;
}

/** 스마트스토어 주문조회 엑셀 파싱 (구매확정만) */
function parseSmartStore(wb: XLSX.WorkBook): SoldRow[] {
  const sheet = wb.Sheets['주문조회'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as any[];
  // 헤더가 바로 첫 행이면 직접 사용, 아니면 raw로 찾기
  const AMOUNT_COLS = ['최종 상품별 총 주문금액', '상품별 총 주문금액', '상품별 총 주문 금액', '최종 상품별 총 주문 금액', '주문금액', '결제금액', '상품금액', '상품주문금액'];
  const pickAmount = (r: Record<string, any>): number | null => { for (const c of AMOUNT_COLS) { if (r[c] !== undefined && r[c] !== '') { const n = Number(String(r[c]).replace(/[^0-9.-]/g, '')); if (isFinite(n)) return n; } } return null; };
  if (rows.length > 0 && rows[0]['주문상태']) {
    return rows
      .filter(r => r['주문상태'] === '구매확정')
      .map(r => { const amt = pickAmount(r); return ({
        name: String(r['상품명'] ?? ''),
        option: String(r['옵션정보'] ?? ''),
        qty: Number(r['수량']) || 1,
        revenue: amt ?? 0,
        revenueMissing: amt == null,
        productId: r['상품번호'] !== undefined ? String(r['상품번호']) : undefined,
        date: pickDateField(r),
      }); });
  }
  // raw 방식 fallback
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i]?.some((c: any) => c === '주문상태')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];
  const headers = raw[headerIdx] as string[];
  const colIdx = (name: string) => headers.indexOf(name);
  const iStatus = colIdx('주문상태'), iName = colIdx('상품명'), iOption = colIdx('옵션정보'), iQty = colIdx('수량'), iPid = colIdx('상품번호');
  const iAmt = AMOUNT_COLS.map(c => colIdx(c)).find(i => i >= 0) ?? -1;
  const dateCandidates = ['결제일자', '결제일', '주문일자', '주문일시'];
  const iDate = dateCandidates.map(c => colIdx(c)).find(i => i >= 0) ?? -1;
  const results: SoldRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row[iStatus] !== '구매확정') continue;
    const amt = iAmt >= 0 ? Number(String(row[iAmt]).replace(/[^0-9.-]/g, '')) : NaN;
    results.push({ name: String(row[iName] ?? ''), option: String(row[iOption] ?? ''), qty: Number(row[iQty]) || 1, revenue: isFinite(amt) ? amt : 0, revenueMissing: !isFinite(amt), productId: iPid >= 0 ? String(row[iPid] ?? '') : undefined, date: iDate >= 0 ? row[iDate] : undefined });
  }
  return results;
}

/** ESM(옥션/지마켓) 주문통합검색 엑셀 파싱 (구매결정완료만) */
function parseESM(wb: XLSX.WorkBook): SoldRow[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i]?.some((c: any) => c === '진행상태')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const headers = raw[headerIdx] as string[];
  const colIdx = (name: string) => headers.indexOf(name);
  const iStatus = colIdx('진행상태');
  const iName = colIdx('상품명');
  const iAmount = colIdx('구매금액');
  const iQty = colIdx('수량');
  const iProductId = colIdx('상품번호');
  const iDate = colIdx('결제일');  // ESM 은 Excel serial number

  const results: SoldRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row[iStatus] !== '구매결정완료') continue;
    results.push({
      name: String(row[iName] ?? ''),
      option: '',
      qty: Number(row[iQty]) || 1,
      revenue: Number(row[iAmount]) || 0,
      vendorId: iProductId >= 0 ? String(row[iProductId] ?? '') : undefined,
      date: iDate >= 0 ? row[iDate] : undefined,
    });
  }
  return results;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const platform = formData.get('platform') as string || 'coupang';
  if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

  let buf = Buffer.from(await file.arrayBuffer());
  // 암호화된 엑셀 자동 복호화 (스마트스토어 등)
  if (officeCrypto.isEncrypted(buf)) {
    try {
      buf = await officeCrypto.decrypt(buf, { password: '123123' });
    } catch { /* 복호화 실패 시 원본으로 시도 */ }
  }
  const wb = XLSX.read(buf);

  // 플랫폼별 파싱
  const soldRows = platform === 'toss' ? parseToss(wb) : platform === 'smartstore' ? parseSmartStore(wb) : platform === 'esm' ? parseESM(wb) : parseCoupang(wb);

  // DB 데이터 로드
  const { data: skus } = await admin.from('skus').select('id, sku_code, cost_price, product:products(name)');
  const { data: rg } = await admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id');
  const { data: ps } = await admin.from('platform_skus').select('platform_sku_id, platform_product_id, sku_id, price, channel:channels(type)');

  const rgMap = new Map((rg ?? []).map((r: any) => [r.vendor_item_id, r.sku_id]));
  const psMap = new Map((ps ?? []).filter((p: any) => p.platform_sku_id).map((p: any) => [p.platform_sku_id, p.sku_id]));
  // 스마트스토어: 상품번호(platform_product_id) → sku, 판매가(금액 컬럼 없는 양식일 때 추정용)
  const ppMap = new Map<string, string>();
  const priceMap = new Map<string, number>();
  for (const p of (ps ?? []) as any[]) {
    if ((p.channel?.type ?? '') === platform || (platform === 'smartstore' && p.channel?.type === 'smartstore')) {
      if (p.platform_product_id && !ppMap.has(String(p.platform_product_id))) ppMap.set(String(p.platform_product_id), p.sku_id);
      if (p.sku_id && Number(p.price) > 0) priceMap.set(p.sku_id, Number(p.price));
    }
  }
  let revenueEstimated = 0, revenueMissingRows = 0;
  const skuMap = new Map((skus ?? []).map((sk: any) => [sk.id, sk]));

  const productCost = new Map<string, number>();
  for (const sk of (skus ?? [])) {
    const name = (sk as any).product?.name || '';
    if (!productCost.has(name)) productCost.set(name, (sk as any).cost_price);
  }

  // 저장된 수기 매핑 로드
  const { data: savedMappings } = await admin.from('cost_mappings').select('product_name, cost_price').eq('platform', platform);
  const mappingMap = new Map<string, number>();
  for (const m of (savedMappings ?? [])) {
    mappingMap.set(m.product_name, Number(m.cost_price));
  }

  let matchCount = 0;
  const details: { name: string; qty: number; unitCost: number; lineCost: number; revenue: number; method: string; skuId: string | null }[] = [];

  for (const row of soldRows) {
    // 1차: vendorItemId 직접 매칭 (쿠팡)
    let skuId: string | undefined = row.vendorId ? (rgMap.get(row.vendorId) || psMap.get(row.vendorId)) as string | undefined : undefined;
    if (!skuId && row.productId && ppMap.has(row.productId)) skuId = ppMap.get(row.productId);
    let cost = skuId ? (skuMap.get(skuId) as any)?.cost_price : null;
    let method = skuId ? 'ID' : null;
    // 금액 컬럼이 없는 양식(스스 기본 양식): 마스터 판매가 × 수량으로 추정
    if (row.revenueMissing) {
      revenueMissingRows++;
      const price = skuId ? priceMap.get(skuId) : undefined;
      if (price) { row.revenue = price * row.qty; revenueEstimated++; }
    }

    // 2차: 상품명 키워드 매칭 (skuId 도 함께 잡기 위해 sku.product.name 매칭)
    if (!cost) {
      const searchText = row.name + ' ' + row.option;
      for (const [keyword, dbName] of Object.entries(NAME_MAP)) {
        if (searchText.includes(keyword)) {
          cost = productCost.get(dbName);
          if (cost) {
            method = 'name';
            // 동일 product.name 의 첫 SKU 찾아서 skuId 지정 (분석용)
            const matchedSku = (skus ?? []).find((s: any) => (s as any).product?.name === dbName);
            if (matchedSku) skuId = (matchedSku as any).id;
            break;
          }
        }
      }
    }

    // 표시명: 옵션명이 상품명을 포함하면 옵션명 그대로, 아니면 "상품명, 옵션"
    const displayName = row.option
      ? (row.option.includes(row.name.substring(0, 10)) ? row.option.substring(0, 55) : `${row.name}, ${row.option}`.substring(0, 55))
      : row.name.substring(0, 55);

    // 3차: 저장된 수기 매핑 (displayName 기준)
    if (!cost) {
      const saved = mappingMap.get(displayName) || mappingMap.get(row.name);
      if (saved && saved > 0) {
        cost = saved;
        method = 'saved';
      }
    }

    if (cost) {
      matchCount++;
      details.push({ name: displayName, qty: row.qty, unitCost: cost, lineCost: cost * row.qty, revenue: row.revenue, method: method!, skuId: skuId ?? null });
    } else {
      details.push({ name: displayName, qty: row.qty, unitCost: 0, lineCost: 0, revenue: row.revenue, method: 'unmatched', skuId: skuId ?? null });
    }
  }

  // 옵션별 집계 (같은 표시명끼리만 합침)
  const grouped = new Map<string, { qty: number; cost: number; revenue: number; unitCost: number; matched: boolean; method: string; skuId: string | null }>();
  for (const d of details) {
    const prev = grouped.get(d.name) || { qty: 0, cost: 0, revenue: 0, unitCost: d.unitCost, matched: d.method !== 'unmatched', method: d.method, skuId: d.skuId };
    prev.qty += d.qty;
    prev.cost += d.lineCost;
    prev.revenue += d.revenue;
    if (!prev.skuId && d.skuId) prev.skuId = d.skuId;
    grouped.set(d.name, prev);
  }

  // 첫 행에 date 있으면 그것으로 월 감지 (쿠팡 인사이트는 날짜 없어서 빈 string)
  let detectedYm = '';
  for (const r of soldRows) {
    if (r.date !== undefined && r.date !== '') {
      detectedYm = toYearMonth(r.date);
      if (detectedYm) break;
    }
  }

  return NextResponse.json({
    platform,
    revenueMissingRows,
    revenueEstimated,
    totalRevenue: soldRows.reduce((s, r) => s + r.revenue, 0),
    totalQty: soldRows.reduce((s, r) => s + r.qty, 0),
    matchCount,
    totalItems: soldRows.length,
    detectedYm,
    products: [...grouped.entries()].map(([name, d]) => ({ name, ...d })).sort((a, b) => b.cost - a.cost),
  });
}

// 수기 매핑 저장 (정산 적용 시 호출)
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const { platform, mappings } = await request.json() as { platform: string; mappings: { name: string; unitCost: number }[] };
  if (!platform || !mappings?.length) return NextResponse.json({ ok: true });

  const admin = await createAdminClient();
  const rows = mappings
    .filter(m => m.unitCost > 0)
    .map(m => ({ platform, product_name: m.name, cost_price: m.unitCost, updated_at: new Date().toISOString() }));

  if (rows.length) {
    await admin.from('cost_mappings').upsert(rows, { onConflict: 'platform,product_name' });
  }

  return NextResponse.json({ ok: true, saved: rows.length });
}
