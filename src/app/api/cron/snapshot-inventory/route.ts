import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = await createAdminClient();
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const { data: invRows } = await admin
    .from('inventory')
    .select('sku_id, warehouse_id, quantity');

  if (!invRows?.length) {
    console.log(`[cron/snapshot-inventory] ${snapshotDate} - no inventory rows`);
    return NextResponse.json({ ok: true, saved: 0 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[cron/snapshot-inventory] ${snapshotDate} - ${rows.length}개 저장`);
  return NextResponse.json({ ok: true, saved: rows.length, snapshot_date: snapshotDate });
}
