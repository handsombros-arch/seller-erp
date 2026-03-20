import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const admin = await createAdminClient();

  const { data } = await admin
    .from('inventory')
    .select('quantity, sku_id, warehouse_id, sku:skus(sku_code, product:products(name)), warehouse:warehouses(name)')
    .lt('quantity', 0)
    .order('quantity', { ascending: true });

  return NextResponse.json({
    count: data?.length ?? 0,
    items: (data ?? []).map((r: any) => ({
      sku_id: r.sku_id,
      sku_code: r.sku?.sku_code ?? '',
      product_name: r.sku?.product?.name ?? '',
      warehouse_name: r.warehouse?.name ?? '',
      quantity: r.quantity,
    })),
  });
}
