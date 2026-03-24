import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runSyncOrders } from '../sync-orders/route';
import { runSyncRgInventory } from '../sync-rg-inventory/route';
import { runRefreshSales } from '../refresh-sales/route';
import { runSnapshotInventory } from '../snapshot-inventory/route';

/**
 * 통합 일일 cron (Vercel Hobby 무료 플랜: cron 1개 제한)
 * 매일 01:00 UTC (10:00 KST) 실행
 * 1. 전 채널 주문 동기화 (쿠팡/네이버/토스) + 재고 차감
 * 2. 쿠팡 RG 재고 동기화
 * 3. 판매량 갱신 (7d/30d)
 * 4. 창고 재고 스냅샷
 *
 * 직접 함수 호출 방식 — Vercel Deployment Protection 우회
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, any> = {};

  // 1. 전 채널 주문 동기화 + 재고 차감 (가장 중요)
  try {
    results.syncOrders = await runSyncOrders();
  } catch (err: any) {
    results.syncOrders = { error: err.message };
  }

  // 2. 쿠팡 RG 재고 동기화
  try {
    results.syncRgInventory = await runSyncRgInventory();
  } catch (err: any) {
    results.syncRgInventory = { error: err.message };
  }

  // 3. 판매량 갱신
  try {
    results.refreshSales = await runRefreshSales();
  } catch (err: any) {
    results.refreshSales = { error: err.message };
  }

  // 4. 창고 재고 스냅샷
  try {
    results.snapshotInventory = await runSnapshotInventory();
  } catch (err: any) {
    results.snapshotInventory = { error: err.message };
  }

  console.log('[cron/daily]', JSON.stringify(results));

  // ─── 특이점 분석 ────────────────────────────────────────────────
  const admin = await createAdminClient();
  const alerts: string[] = [];

  // 1) 주문 급증/급감 (전일 vs 전전일 비교, ±50% 이상)
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const { count: yCnt } = await admin.from('channel_orders').select('*', { count: 'exact', head: true }).eq('order_date', yesterday);
    const { count: dCnt } = await admin.from('channel_orders').select('*', { count: 'exact', head: true }).eq('order_date', dayBefore);
    const y = yCnt ?? 0;
    const d = dCnt ?? 0;
    if (d > 0) {
      const pct = Math.round(((y - d) / d) * 100);
      if (pct >= 50) alerts.push(`주문 급증 ${yesterday}: ${y}건 (전일 대비 +${pct}%)`);
      else if (pct <= -50) alerts.push(`주문 급감 ${yesterday}: ${y}건 (전일 대비 ${pct}%)`);
    }
  } catch {}

  // 2) 발주 필요 SKU (안전재고 이하)
  try {
    const { data: reorderSkus } = await admin
      .from('skus')
      .select('id, sku_code, reorder_point')
      .gt('reorder_point', 0);
    if (reorderSkus) {
      let needReorder = 0;
      for (const sku of reorderSkus) {
        const { data: inv } = await admin
          .from('inventory')
          .select('quantity')
          .eq('sku_id', sku.id);
        const totalQty = (inv ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
        if (totalQty <= (sku.reorder_point ?? 0)) needReorder++;
      }
      if (needReorder > 0) alerts.push(`발주 필요 ${needReorder}개 SKU (안전재고 이하)`);
    }
  } catch {}

  // Slack 알림
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    const syncOrders = results.syncOrders ?? {};
    const lines = [
      `*LV ERP 일일 동기화 완료* (${new Date().toISOString().slice(0, 10)})`,
      '',
      `*주문 동기화*`,
      `  쿠팡 그로스: ${syncOrders.coupang_rg?.synced ?? 0}건`,
      `  쿠팡 Wing: ${syncOrders.coupang_wing?.synced ?? 0}건`,
      `  스마트스토어: ${syncOrders.smartstore?.synced ?? 0}건`,
      `  토스: ${syncOrders.toss?.synced ?? 0}건`,
      `  재고 차감: ${syncOrders.inventory?.deducted ?? 0}건 · 복구: ${syncOrders.inventory?.restored ?? 0}건`,
      '',
      `*RG 재고*: ${results.syncRgInventory?.synced ?? 0}개`,
      `*판매량 갱신*: ${results.refreshSales?.sku_count ?? 0}개 SKU`,
      `*창고 스냅샷*: ${results.snapshotInventory?.saved ?? 0}개`,
    ];

    // 3) 동기화 실패
    const errors: string[] = [];
    if (syncOrders.coupang_rg?.error) errors.push(`쿠팡RG: ${syncOrders.coupang_rg.error}`);
    if (syncOrders.coupang_wing?.error) errors.push(`쿠팡Wing: ${syncOrders.coupang_wing.error}`);
    if (syncOrders.smartstore?.error) errors.push(`네이버: ${syncOrders.smartstore.error}`);
    if (syncOrders.toss?.error) errors.push(`토스: ${syncOrders.toss.error}`);
    if (results.syncRgInventory?.error) errors.push(`RG재고: ${results.syncRgInventory.error}`);
    if (errors.length) alerts.push(`동기화 실패: ${errors.join(', ')}`);

    // 특이점 출력
    if (alerts.length) {
      lines.push('', `*특이점*`);
      for (const a of alerts) lines.push(`  · ${a}`);
    }

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
