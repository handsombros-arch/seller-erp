'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MCost, Market, Snapshot } from './settlement';

/** 정산 항목 구조 + 전체 월 스냅샷. 분석·추이 화면 공용. */
export function useSettlementData(reloadKey = 0) {
  const [items, setItems] = useState<MCost[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([fetch('/api/monthly-costs'), fetch('/api/monthly-costs?history=all')]);
      if (!a.ok || !b.ok) throw new Error(`불러오기 실패 (${a.status}/${b.status})`);
      const it: MCost[] = await a.json();
      const snaps: any[] = await b.json();
      setItems(it);
      setSnapshots(snaps.map(s => ({ year_month: s.year_month, cost_id: s.cost_id, amount: Number(s.amount) || 0 })));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, reloadKey]);

  const months = useMemo(() => [...new Set(snapshots.map(s => s.year_month))].sort().reverse(), [snapshots]);

  const amountsFor = useCallback((ym: string) => {
    const m = new Map<string, number>();
    for (const s of snapshots) if (s.year_month === ym) m.set(s.cost_id, s.amount);
    return m;
  }, [snapshots]);

  return { items, snapshots, months, loading, error, reload, amountsFor };
}

/** 월별 마켓 출고 건수 (공통 물류비 건수 비례 배분용). channel_orders 기준. */
export function useOrderCounts(ym: string | null) {
  const [counts, setCounts] = useState<Partial<Record<Market, number>> | null>(null);
  useEffect(() => {
    if (!ym) return;
    let cancelled = false;
    (async () => {
      const [y, m] = ym.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const res = await fetch(`/api/channel-orders?from=${ym}-01&to=${ym}-${String(last).padStart(2, '0')}`);
      if (!res.ok) { if (!cancelled) setCounts({}); return; }
      const rows: any[] = await res.json();
      const acc: Partial<Record<Market, number>> = {};
      for (const r of rows) {
        const ch = String(r.channel ?? '');
        const mk: Market | null = /^coupang/.test(ch) ? 'coupang' : ch === 'toss' ? 'toss' : ch === 'smartstore' ? 'smartstore' : /esm|gmarket|auction/.test(ch) ? 'esm' : /talk/.test(ch) ? 'talkdeal' : null;
        if (!mk) continue;
        if (/취소|cancel/i.test(String(r.order_status ?? '')) || r.claim_type === 'cancel') continue;
        acc[mk] = (acc[mk] ?? 0) + 1;
      }
      if (!cancelled) setCounts(acc);
    })();
    return () => { cancelled = true; };
  }, [ym]);
  return counts;
}
