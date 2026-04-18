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

  const results: SoldRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row[iStatus] !== '구매확정') continue;
    results.push({
      name: String(row[iName] ?? ''),
      option: String(row[iOption] ?? ''),
      qty: Number(row[iQty]) || 1,
      revenue: Number(row[iAmount]) || 0,
    });
  }
  return results;
}

/** 스마트스토어 주문조회 엑셀 파싱 (구매확정만) */
function parseSmartStore(wb: XLSX.WorkBook): SoldRow[] {
  const sheet = wb.Sheets['주문조회'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as any[];
  // 헤더가 바로 첫 행이면 직접 사용, 아니면 raw로 찾기
  if (rows.length > 0 && rows[0]['주문상태']) {
    return rows
      .filter(r => r['주문상태'] === '구매확정')
      .map(r => ({
        name: String(r['상품명'] ?? ''),
        option: String(r['옵션정보'] ?? ''),
        qty: Number(r['수량']) || 1,
        revenue: 0,
      }));
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
  const iStatus = colIdx('주문상태'), iName = colIdx('상품명'), iOption = colIdx('옵션정보'), iQty = colIdx('수량');
  const results: SoldRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row[iStatus] !== '구매확정') continue;
    results.push({ name: String(row[iName] ?? ''), option: String(row[iOption] ?? ''), qty: Number(row[iQty]) || 1, revenue: 0 });
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
  const soldRows = platform === 'toss' ? parseToss(wb) : platform === 'smartstore' ? parseSmartStore(wb) : parseCoupang(wb);

  // DB 데이터 로드
  const { data: skus } = await admin.from('skus').select('id, sku_code, cost_price, product:products(name)');
  const { data: rg } = await admin.from('rg_inventory_snapshots').select('vendor_item_id, sku_id');
  const { data: ps } = await admin.from('platform_skus').select('platform_sku_id, sku_id');

  const rgMap = new Map((rg ?? []).map((r: any) => [r.vendor_item_id, r.sku_id]));
  const psMap = new Map((ps ?? []).filter((p: any) => p.platform_sku_id).map((p: any) => [p.platform_sku_id, p.sku_id]));
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
  const details: { name: string; qty: number; unitCost: number; lineCost: number; revenue: number; method: string }[] = [];

  for (const row of soldRows) {
    // 1차: vendorItemId 직접 매칭 (쿠팡)
    let skuId = row.vendorId ? (rgMap.get(row.vendorId) || psMap.get(row.vendorId)) : undefined;
    let cost = skuId ? (skuMap.get(skuId) as any)?.cost_price : null;
    let method = skuId ? 'ID' : null;

    // 2차: 상품명 키워드 매칭
    if (!cost) {
      const searchText = row.name + ' ' + row.option;
      for (const [keyword, dbName] of Object.entries(NAME_MAP)) {
        if (searchText.includes(keyword)) {
          cost = productCost.get(dbName);
          if (cost) { method = 'name'; break; }
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
      details.push({ name: displayName, qty: row.qty, unitCost: cost, lineCost: cost * row.qty, revenue: row.revenue, method: method! });
    } else {
      details.push({ name: displayName, qty: row.qty, unitCost: 0, lineCost: 0, revenue: row.revenue, method: 'unmatched' });
    }
  }

  // 옵션별 집계 (같은 표시명끼리만 합침)
  const grouped = new Map<string, { qty: number; cost: number; revenue: number; unitCost: number; matched: boolean; method: string }>();
  for (const d of details) {
    const prev = grouped.get(d.name) || { qty: 0, cost: 0, revenue: 0, unitCost: d.unitCost, matched: d.method !== 'unmatched', method: d.method };
    prev.qty += d.qty;
    prev.cost += d.lineCost;
    prev.revenue += d.revenue;
    grouped.set(d.name, prev);
  }

  return NextResponse.json({
    platform,
    totalRevenue: soldRows.reduce((s, r) => s + r.revenue, 0),
    totalQty: soldRows.reduce((s, r) => s + r.qty, 0),
    matchCount,
    totalItems: soldRows.length,
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
