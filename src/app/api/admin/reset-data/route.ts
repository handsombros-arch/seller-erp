import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const TABLES = [
  'inventory_snapshots',
  'inventory_adjustments',
  'channel_orders',
  'channel_sales',
  'inbound_records',
  'outbound_records',
  'purchase_order_items',
  'purchase_orders',
  'inventory',
  'platform_skus',
  'sku_name_aliases',
  'skus',
  'products',
  'suppliers',
];

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  // 존재하는 테이블만 골라서 삭제 (CASCADE 포함)
  const { data: existingTables } = await admin
    .from('information_schema.tables' as any)
    .select('table_name')
    .eq('table_schema', 'public')
    .in('table_name', TABLES);

  const existing = new Set((existingTables ?? []).map((r: any) => r.table_name as string));
  const toTruncate = TABLES.filter((t) => existing.has(t));

  if (!toTruncate.length) return NextResponse.json({ ok: true, cleared: [] });

  // Supabase JS client doesn't support TRUNCATE — use rpc or raw query via pg
  // We delete in FK-safe order using DELETE (cascades handled by FK ON DELETE CASCADE)
  const errors: string[] = [];
  for (const table of toTruncate) {
    const { error } = await admin.from(table as any).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) errors.push(`${table}: ${error.message}`);
  }

  return NextResponse.json({ ok: errors.length === 0, cleared: toTruncate, errors });
}
