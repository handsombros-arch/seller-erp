import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

interface ImportRow {
  sku_code: string;
  warehouse_name: string;
  quantity: number;
  reason?: string;
}

// 월별 실사용 reason prefix — applyOrders 가 cutoff 로 인식.
// 일반 "수동 조정" 도 동일 효과지만 이 prefix 가 들어간 행은 history 화면에서 "월별 실사" 로 라벨링됨.
export const PHYSICAL_COUNT_PREFIX = '__PHYSICAL_COUNT__:';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

    const body = await request.json();
    const { rows, physicalCount } = body as { rows: ImportRow[]; physicalCount?: boolean };
    // physicalCount=true 면 reason 에 __PHYSICAL_COUNT__:<YYYY-MM-DD> prefix 자동 부여
    const today = new Date().toISOString().slice(0, 10);
    const physicalReason = `${PHYSICAL_COUNT_PREFIX}${today}`;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: '행 데이터가 없습니다' }, { status: 400 });
    }

    const admin = await createAdminClient();

    // Build lookup maps
    const { data: skus } = await admin.from('skus').select('id, sku_code');
    const { data: warehouses } = await admin.from('warehouses').select('id, name');

    const skuMap = new Map((skus ?? []).map((s: any) => [String(s.sku_code).trim().toLowerCase(), s.id as string]));
    const whMap  = new Map((warehouses ?? []).map((w: any) => [String(w.name).trim().toLowerCase(), w.id as string]));

    let success = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const skuId = skuMap.get(String(row.sku_code ?? '').trim().toLowerCase());
      const whId  = whMap.get(String(row.warehouse_name ?? '').trim().toLowerCase());

      if (!skuId) { errors.push({ row: i + 1, message: `SKU코드를 찾을 수 없음: ${row.sku_code}` }); continue; }
      if (!whId)  { errors.push({ row: i + 1, message: `창고명을 찾을 수 없음: ${row.warehouse_name}` }); continue; }

      const newQty = Number(row.quantity);
      if (isNaN(newQty) || newQty < 0) { errors.push({ row: i + 1, message: `수량이 올바르지 않음: ${row.quantity}` }); continue; }

      // physicalCount 모드면 우선 적용. row 별 reason 이 비어있으면 "CSV 일괄 기입" fallback.
      const customReason = String(row.reason ?? '').trim();
      const reason = physicalCount
        ? (customReason ? `${physicalReason} ${customReason}` : physicalReason)
        : (customReason || 'CSV 일괄 기입');

      // Get current quantity
      const { data: current } = await admin
        .from('inventory')
        .select('quantity')
        .eq('sku_id', skuId)
        .eq('warehouse_id', whId)
        .maybeSingle();

      const oldQty = current?.quantity ?? 0;

      // Record adjustment
      await admin.from('inventory_adjustments').insert({
        sku_id: skuId,
        warehouse_id: whId,
        before_quantity: oldQty,
        after_quantity: newQty,
        reason,
        adjusted_by: user.id,
      });

      // Upsert inventory
      const { error } = await admin
        .from('inventory')
        .upsert({ sku_id: skuId, warehouse_id: whId, quantity: newQty }, { onConflict: 'sku_id,warehouse_id' });

      if (error) { errors.push({ row: i + 1, message: error.message }); }
      else { success++; }
    }

    return NextResponse.json({ success, errors });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? '서버 오류' }, { status: 500 });
  }
}
