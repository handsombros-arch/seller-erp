import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const body = await request.json();
  const { rows } = body as { rows: Record<string, string>[] };
  if (!rows?.length) return NextResponse.json({ error: '데이터 없음' }, { status: 400 });

  const admin = await createAdminClient();

  // 공급처 이름 → id
  const { data: suppliers } = await admin.from('suppliers').select('id, name').eq('is_active', true);
  const supplierMap = new Map<string, string>();
  for (const s of suppliers ?? []) supplierMap.set(s.name.trim().toLowerCase(), s.id);

  // 기존 상품 중복 방지
  const { data: existingProducts } = await admin.from('products').select('id, name');
  const productMap = new Map<string, string>();
  for (const p of existingProducts ?? []) productMap.set(p.name.trim().toLowerCase(), p.id);

  // 초기재고 입력 시 넣을 자사창고 (own 타입 중 첫 번째)
  const { data: warehouses } = await admin.from('warehouses').select('id, name, type').eq('is_active', true);
  const defaultWarehouse = (warehouses ?? []).find((w: any) => w.type === 'own') ?? null;

  let productsCreated = 0, skusCreated = 0, inventorySet = 0;
  const errors: string[] = [];

  for (const row of rows) {
    // 설명 행(#으로 시작) 건너뜀
    const productName = String(row['상품명'] ?? '').trim();
    if (!productName || productName.startsWith('#')) continue;

    // ── 상품 생성 또는 조회 ──────────────────────────────────────────────
    let productId = productMap.get(productName.toLowerCase());
    if (!productId) {
      const { data: newProduct, error: pErr } = await admin
        .from('products')
        .insert({
          name:     productName,
          category: row['카테고리']?.trim() || null,
          brand:    row['브랜드']?.trim() || null,
        })
        .select('id')
        .single();

      if (pErr) { errors.push(`상품 "${productName}": ${pErr.message}`); continue; }
      productId = newProduct.id as string;
      productMap.set(productName.toLowerCase(), productId);
      productsCreated++;
    }

    // ── SKU 코드 ──────────────────────────────────────────────────────────
    const skuCode = String(row['SKU코드'] ?? '').trim();
    if (!skuCode) { errors.push(`"${productName}" 행에 SKU코드 없음`); continue; }

    // ── 옵션 조합 ─────────────────────────────────────────────────────────
    // 신규 형식: 색상 / 사이즈 / 기타옵션 컬럼
    // 구형 형식(하위 호환): 옵션1유형+옵션1값 / 옵션2유형+옵션2값
    const option_values: Record<string, string> = {};

    const color     = row['색상']?.trim();
    const size      = row['사이즈']?.trim();
    const etcOption = row['기타옵션']?.trim();

    if (size)      option_values['사이즈']  = size;
    if (color)     option_values['색상']    = color;
    if (etcOption && etcOption !== '단일상품') option_values['기타'] = etcOption;

    // 구형 컬럼 하위 호환
    if (!color && !size && !etcOption) {
      const t1 = row['옵션1유형']?.trim(), v1 = row['옵션1값']?.trim();
      const t2 = row['옵션2유형']?.trim(), v2 = row['옵션2값']?.trim();
      if (t1 && v1) option_values[t1] = v1;
      if (t2 && v2) option_values[t2] = v2;
    }

    // ── 공급처 매핑 ───────────────────────────────────────────────────────
    const supplierName = row['공급처명']?.trim();
    const supplierId   = supplierName ? (supplierMap.get(supplierName.toLowerCase()) ?? null) : null;

    // ── SKU 생성 ──────────────────────────────────────────────────────────
    const { data: newSku, error: skuErr } = await admin
      .from('skus')
      .insert({
        product_id:     productId,
        sku_code:       skuCode,
        option_values:  Object.keys(option_values).length ? option_values : {},
        cost_price:     Number(row['원가']) || 0,
        logistics_cost: Number(row['물류비']) || 0,
        lead_time_days: Number(row['리드타임(일)'] ?? row['리드타임']) || 21,
        reorder_point:  Number(row['발주점']) || 0,
        safety_stock:   Number(row['안전재고']) || 0,
        supplier_id:    supplierId,
      })
      .select('id')
      .single();

    if (skuErr) {
      if (skuErr.code === '23505') {
        errors.push(`SKU "${skuCode}" 이미 존재 (건너뜀)`);
      } else {
        errors.push(`SKU "${skuCode}": ${skuErr.message}`);
      }
      continue;
    }

    skusCreated++;

    // ── 초기재고 설정 ─────────────────────────────────────────────────────
    const initQty = Number(row['초기재고'] ?? 0);
    if (initQty > 0 && defaultWarehouse && newSku?.id) {
      const { error: invErr } = await admin
        .from('inventory')
        .upsert(
          { sku_id: newSku.id, warehouse_id: defaultWarehouse.id, quantity: initQty },
          { onConflict: 'sku_id,warehouse_id', ignoreDuplicates: false }
        );
      if (!invErr) inventorySet++;
      else errors.push(`SKU "${skuCode}" 초기재고 설정 실패: ${invErr.message}`);
    }
  }

  return NextResponse.json({ productsCreated, skusCreated, inventorySet, errors });
}
