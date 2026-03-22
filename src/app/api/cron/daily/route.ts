import { NextRequest, NextResponse } from 'next/server';

/**
 * 통합 일일 cron (Vercel Hobby 무료 플랜: cron 1개 제한)
 * 매일 01:00 UTC (10:00 KST) 실행
 * 1. 전 채널 주문 동기화 (쿠팡/네이버/토스) + 재고 차감
 * 2. 쿠팡 RG 재고 동기화
 * 3. 판매량 갱신 (7d/30d)
 * 4. 창고 재고 스냅샷
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = request.nextUrl.origin;
  const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
  const results: Record<string, any> = {};

  // 1. 전 채널 주문 동기화 + 재고 차감 (가장 중요)
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-orders`, { headers });
    results.syncOrders = await res.json();
  } catch (err: any) {
    results.syncOrders = { error: err.message };
  }

  // 2. 쿠팡 RG 재고 동기화
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-rg-inventory`, { headers });
    results.syncRgInventory = await res.json();
  } catch (err: any) {
    results.syncRgInventory = { error: err.message };
  }

  // 3. 판매량 갱신
  try {
    const res = await fetch(`${baseUrl}/api/cron/refresh-sales`, { headers });
    results.refreshSales = await res.json();
  } catch (err: any) {
    results.refreshSales = { error: err.message };
  }

  // 4. 창고 재고 스냅샷
  try {
    const res = await fetch(`${baseUrl}/api/cron/snapshot-inventory`, { headers });
    results.snapshotInventory = await res.json();
  } catch (err: any) {
    results.snapshotInventory = { error: err.message };
  }

  console.log('[cron/daily]', JSON.stringify(results));

  // Slack 알림
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    const syncOrders = results.syncOrders ?? {};
    const lines = [
      `*ERP 일일 동기화 완료* (${new Date().toISOString().slice(0, 10)})`,
      '',
      `*주문 동기화*`,
      `  쿠팡 그로스: ${syncOrders.coupang_rg?.synced ?? 0}건`,
      `  스마트스토어: ${syncOrders.smartstore?.synced ?? 0}건`,
      `  토스: ${syncOrders.toss?.synced ?? 0}건`,
      `  재고 차감: ${syncOrders.inventory?.deducted ?? 0}건 · 복구: ${syncOrders.inventory?.restored ?? 0}건`,
      '',
      `*RG 재고*: ${results.syncRgInventory?.synced ?? 0}개`,
      `*판매량 갱신*: ${results.refreshSales?.sku_count ?? 0}개 SKU`,
      `*창고 스냅샷*: ${results.snapshotInventory?.saved ?? 0}개`,
    ];
    // 에러 있으면 표시
    const errors: string[] = [];
    if (syncOrders.coupang_rg?.error) errors.push(`쿠팡: ${syncOrders.coupang_rg.error}`);
    if (syncOrders.smartstore?.error) errors.push(`네이버: ${syncOrders.smartstore.error}`);
    if (syncOrders.toss?.error) errors.push(`토스: ${syncOrders.toss.error}`);
    if (errors.length) lines.push('', `⚠️ *오류*: ${errors.join(' / ')}`);

    try {
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch {}
  }

  return NextResponse.json({ ok: true, ...results });
}
