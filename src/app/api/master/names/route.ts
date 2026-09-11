import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/master/names — 옵션ID → 마켓이 실제로 쓰는 상품명 (마스터 "이름 자동 채우기"용)
 *  - 쿠팡: RG 재고 스냅샷 item_name(최신), 광고 월 집계 name
 *  - 토스: 광고 월 집계 name (옵션 ID 기준)
 * 반환 { names: { [vid]: { name, source, platform } } }
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  const admin = await createAdminClient();
  const [rg, ads] = await Promise.all([
    admin.from('rg_inventory_snapshots').select('vendor_item_id, item_name, snapshot_date').order('snapshot_date', { ascending: false }).limit(4000)
      .then(r => r.error ? admin.from('rg_inventory_snapshots').select('vendor_item_id, item_name').limit(4000) : r),
    admin.from('monthly_product_ads').select('vendor_item_id, name, platform, year_month').eq('user_id', user.id).order('year_month', { ascending: false }).limit(5000),
  ]);
  const names: Record<string, { name: string; source: string; platform: string }> = {};
  for (const r of (rg.data ?? []) as any[]) { const v = String(r.vendor_item_id ?? ''); if (v && r.item_name && !names[v]) names[v] = { name: String(r.item_name), source: 'RG 재고', platform: 'coupang' }; }
  for (const r of (ads.data ?? []) as any[]) { const v = String(r.vendor_item_id ?? ''); if (v && r.name && !names[v]) names[v] = { name: String(r.name), source: `광고 ${r.year_month}`, platform: String(r.platform) }; }
  return NextResponse.json({ names });
}
