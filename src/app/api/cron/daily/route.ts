import { NextRequest, NextResponse } from 'next/server';

/**
 * 통합 일일 cron (Vercel Hobby 무료 플랜: cron 1개 제한)
 * 매일 01:00 UTC 실행
 * 1. 쿠팡 RG 재고 동기화
 * 2. 판매량 갱신 (7d/30d)
 * 3. 창고 재고 스냅샷
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = request.nextUrl.origin;
  const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
  const results: Record<string, any> = {};

  // 1. 쿠팡 RG 재고 동기화
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-rg-inventory`, { headers });
    results.syncRgInventory = await res.json();
  } catch (err: any) {
    results.syncRgInventory = { error: err.message };
  }

  // 2. 판매량 갱신
  try {
    const res = await fetch(`${baseUrl}/api/cron/refresh-sales`, { headers });
    results.refreshSales = await res.json();
  } catch (err: any) {
    results.refreshSales = { error: err.message };
  }

  // 3. 창고 재고 스냅샷
  try {
    const res = await fetch(`${baseUrl}/api/cron/snapshot-inventory`, { headers });
    results.snapshotInventory = await res.json();
  } catch (err: any) {
    results.snapshotInventory = { error: err.message };
  }

  console.log('[cron/daily]', JSON.stringify(results));
  return NextResponse.json({ ok: true, ...results });
}
