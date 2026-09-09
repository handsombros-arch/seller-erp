'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MCost, Market, Snapshot } from './settlement';

/** 정산 항목 구조 + 전체 월 스냅샷. 분석·추이 화면 공용. */
export interface ClosedMonth { closed_at: string; note?: string | null }
export interface AdMonth { year_month: string; rows_count: number; cost: number }

/** 첫 화면 데이터를 부트스트랩 API 한 번으로 (여러 API 동시 호출 → 콜드 스타트 겹침 방지) */
export function useSettlementData(reloadKey = 0, ym?: string) {
  const [items, setItems] = useState<MCost[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [closed, setClosed] = useState<Record<string, ClosedMonth>>({});
  const [closedSupported, setClosedSupported] = useState(true);
  const [salesPlatforms, setSalesPlatforms] = useState<string[]>([]);
  const [adMonths, setAdMonths] = useState<AdMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/settlement/bootstrap?year_month=${ym ?? ''}`);
      if (!r.ok) throw new Error(`불러오기 실패 (${r.status})`);
      const j = await r.json();
      setItems(j.items ?? []);
      setSnapshots((j.snapshots ?? []).map((s: any) => ({ year_month: s.year_month, cost_id: s.cost_id, amount: Number(s.amount) || 0, note: s.note ?? null, ref_amount: s.ref_amount == null ? null : Number(s.ref_amount), ref_source: s.ref_source ?? null, ref_detail: s.ref_detail ?? null, qty: s.qty == null ? null : Number(s.qty) })));
      const cm: Record<string, ClosedMonth> = {};
      for (const c of j.closed ?? []) cm[c.year_month] = { closed_at: c.closed_at, note: c.note };
      setClosed(cm);
      setClosedSupported(j.closedSupported !== false);
      setSalesPlatforms(j.salesPlatforms ?? []);
      setAdMonths(j.adMonths ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '오류');
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { reload(); }, [reload, reloadKey]);

  const months = useMemo(() => [...new Set(snapshots.map(s => s.year_month))].sort().reverse(), [snapshots]);

  const amountsFor = useCallback((ym: string) => {
    const m = new Map<string, number>();
    for (const s of snapshots) if (s.year_month === ym) m.set(s.cost_id, s.amount);
    return m;
  }, [snapshots]);

  return { items, snapshots, months, loading, error, reload, amountsFor, closed, closedSupported, salesPlatforms, adMonths };
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
