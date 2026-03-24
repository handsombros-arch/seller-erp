import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * 창고 재고 스냅샷 핵심 로직 (직접 호출용)
 */
export async function runSnapshotInventory(): Promise<Record<string, any>> {
  const admin = await createAdminClient();
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const { data: invRows } = await admin
    .from('inventory')
    .select('sku_id, warehouse_id, quantity');

  if (!invRows?.length) {
    console.log(`[cron/snapshot-inventory] ${snapshotDate} - no inventory rows`);
    return { ok: true, saved: 0 };
  }

  const rows = invRows.map((r: any) => ({
    snapshot_date: snapshotDate,
    sku_id: r.sku_id,
    warehouse_id: r.warehouse_id,
    quantity: r.quantity,
  }));

  const { error } = await admin
    .from('warehouse_inventory_snapshots')
    .upsert(rows, { onConflict: 'snapshot_date,sku_id,warehouse_id', ignoreDuplicates: false });

  if (error) {
    console.error(`[cron/snapshot-inventory] error:`, error.message);
    return { error: error.message };
  }

  console.log(`[cron/snapshot-inventory] ${snapshotDate} - ${rows.length}개 저장`);
  return { ok: true, saved: rows.length, snapshot_date: snapshotDate };
}

/**
 * HTTP 엔드포인트 (수동 트리거용)
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runSnapshotInventory();
  return NextResponse.json(result);
}
