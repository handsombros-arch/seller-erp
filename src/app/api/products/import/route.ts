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

  // Load existing suppliers for name → id lookup
  const { data: suppliers } = await admin.from('suppliers').select('id, name').eq('is_active', true);
  const supplierMap = new Map<string, string>();
  for (const s of suppliers ?? []) supplierMap.set(s.name.trim().toLowerCase(), s.id);

  // Load existing products for deduplication
  const { data: existingProducts } = await admin.from('products').select('id, name');
  const productMap = new Map<string, string>();
  for (const p of existingProducts ?? []) productMap.set(p.name.trim().toLowerCase(), p.id);

  let productsCreated = 0, skusCreated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const productName = String(row['상품명'] ?? '').trim();
    if (!productName) continue;

    // Get or create product
    let productId = productMap.get(productName.toLowerCase());
    if (!productId) {
      const { data: newProduct, error: pErr } = await admin.from('products').insert({
        name: productName,
        category: row['카테고리']?.trim() || null,
        brand: row['브랜드']?.trim() || null,
      }).select('id').single();
      if (pErr) { errors.push(`상품 "${productName}": ${pErr.message}`); continue; }
      productId = newProduct.id as string;
      productMap.set(productName.toLowerCase(), productId);
      productsCreated++;
    }

    const skuCode = String(row['SKU코드'] ?? '').trim();
    if (!skuCode) { errors.push(`"${productName}" 행에 SKU코드 없음`); continue; }

    // Build option_values
    const option_values: Record<string, string> = {};
    if (row['옵션1유형']?.trim() && row['옵션1값']?.trim()) option_values[row['옵션1유형'].trim()] = row['옵션1값'].trim();
    if (row['옵션2유형']?.trim() && row['옵션2값']?.trim()) option_values[row['옵션2유형'].trim()] = row['옵션2값'].trim();

    const supplierName = row['공급처명']?.trim();
    const supplierId = supplierName ? (supplierMap.get(supplierName.toLowerCase()) ?? null) : null;

    const { error: skuErr } = await admin.from('skus').insert({
      product_id: productId,
      sku_code: skuCode,
      option_values: Object.keys(option_values).length ? option_values : {},
      cost_price: Number(row['원가']) || 0,
      logistics_cost: Number(row['물류비']) || 0,
      safety_stock: Number(row['안전재고']) || 0,
      reorder_point: Number(row['발주점']) || 0,
      lead_time_days: Number(row['리드타임(일)']) || 21,
      supplier_id: supplierId,
    });

    if (skuErr) {
      if (skuErr.message.includes('duplicate') || skuErr.message.includes('unique') || skuErr.code === '23505') {
        errors.push(`SKU "${skuCode}" 이미 존재 (건너뜀)`);
      } else {
        errors.push(`SKU "${skuCode}": ${skuErr.message}`);
      }
    } else {
      skusCreated++;
    }
  }

  return NextResponse.json({ productsCreated, skusCreated, errors });
}
