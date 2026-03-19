import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// 포함 매칭: 둘 중 하나가 다른 쪽의 부분 문자열 (최소 8자)
function containsMatch(a: string, b: string) {
  if (a.length < 8 || b.length < 8) return false;
  return a.includes(b) || b.includes(a);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const formData = await request.formData();
  const file   = formData.get('file') as File | null;
  const period = formData.get('period') as '7d' | '30d' | null;
  const daysParam = formData.get('days');
  const days = daysParam ? Math.max(1, Number(daysParam)) : (period === '7d' ? 7 : 30);

  if (!file || !period) {
    return NextResponse.json({ error: 'file, period 필수' }, { status: 400 });
  }

  // ── Excel 파싱
  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (rows.length < 2) {
    return NextResponse.json({ error: '데이터가 없습니다' }, { status: 400 });
  }

  // 헤더 인덱스
  const header: string[] = (rows[0] ?? []).map((h: any) => String(h ?? '').trim());
  const idx = {
    optionId:    header.findIndex((h) => h.includes('옵션 ID') || h.includes('옵션ID')),
    optionName:  header.findIndex((h) => h === '옵션명'),
    productName: header.findIndex((h) => h === '상품명'),
    salesQty:    header.findIndex((h) => h === '판매량' || h === '총 판매수'),
  };

  if (idx.salesQty < 0) {
    return NextResponse.json({ error: '판매량 컬럼을 찾을 수 없습니다' }, { status: 400 });
  }

  const admin = await createAdminClient();

  // ── 매칭 소스 로드 (platform_skus + sku_code)
  const { data: platformSkus } = await admin
    .from('platform_skus')
    .select('platform_product_name, sku_id');

  const { data: skuList } = await admin.from('skus').select('id, sku_code');

  // nameMap: normalized name → sku_id (정확 매칭용)
  const nameMap = new Map<string, string>();
  for (const ps of platformSkus ?? []) {
    if (ps.platform_product_name) {
      nameMap.set(normalize(ps.platform_product_name), ps.sku_id);
    }
  }
  for (const s of skuList ?? []) {
    nameMap.set(normalize(s.sku_code), s.id);
  }

  // ── Excel 행별 집계
  const salesMap: Record<string, number> = {};
  const unmatched: { optionId: string; optionName: string; productName: string; qty: number }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const optionId    = String(row[idx.optionId]    ?? '').trim();
    const optionName  = String(row[idx.optionName]  ?? '').trim();
    const productName = String(row[idx.productName] ?? '').trim();
    const qty = Number(row[idx.salesQty] ?? 0);
    if (!qty) continue;

    const nProduct = normalize(productName);
    const nOption  = normalize(optionName);
    const nFirst   = normalize(optionName.split(',')[0] ?? ''); // 옵션명 첫 번째 부분

    // 1단계: 정확 매칭 (optionName 전체 → productName → 첫 번째 부분)
    let skuId =
      nameMap.get(nOption) ??
      nameMap.get(nProduct) ??
      nameMap.get(nFirst);

    // 2단계: 포함 매칭 (platform name이 product name의 부분 문자열이거나 그 반대)
    if (!skuId) {
      for (const [key, id] of nameMap) {
        if (containsMatch(nProduct, key) || containsMatch(nFirst, key)) {
          skuId = id;
          break;
        }
      }
    }

    if (skuId) {
      salesMap[skuId] = (salesMap[skuId] ?? 0) + qty;
    } else {
      unmatched.push({ optionId, optionName, productName, qty });
    }
  }

  // ── skus 업데이트
  // 재고예측에서 sales_7d/7, sales_30d/30으로 일평균 계산하므로
  // 실제 기간(days)으로 일평균을 구한 뒤 해당 필드의 일수(7 or 30)로 다시 곱해 정규화
  const fieldDays = period === '7d' ? 7 : 30;
  const field = period === '7d' ? 'sales_7d' : 'sales_30d';
  let updated = 0;

  for (const [skuId, qty] of Object.entries(salesMap)) {
    const normalized = Math.round((qty / days) * fieldDays);
    const { error } = await admin
      .from('skus')
      .update({ [field]: normalized })
      .eq('id', skuId);
    if (!error) updated++;
  }

  return NextResponse.json({
    updated,
    unmatched_count: unmatched.length,
    unmatched: unmatched.slice(0, 20),
    period,
    days,
  });
}
