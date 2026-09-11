'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Megaphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { fmtNum, lastMonths } from '../_lib/settlement';
import { aggregateLocalAdRows, readLocalAdRows } from '../_lib/adRawLocal';

interface MonthRow { year_month: string; rows_count: number; cost: number }

/**
 * 광고비 raw 현황 + "이 PC 광고 raw → 월 집계 저장".
 * 광고 분석에 올린 raw 는 브라우저에만 있어도 되고, 여기서 월·옵션ID 요약만 DB(monthly_product_ads)에 저장한다.
 */
export function AdCoverageCard({ selectedYm, months: monthsProp, onSaved }: { selectedYm: string; months?: MonthRow[]; onSaved?: () => void }) {
  const [months, setMonths] = useState<MonthRow[] | null>(monthsProp ?? null);
  useEffect(() => { if (monthsProp) setMonths(monthsProp); }, [monthsProp]);
  const [busy, setBusy] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<{ rows: number; months: string[] } | null>(null);
  const toast = useToast();

  const [tossMonths, setTossMonths] = useState<MonthRow[] | null>(null);
  const [tossBusy, setTossBusy] = useState(false);
  const load = useCallback(() => {
    fetch('/api/settlement/product-ads?months=1').then(r => r.json()).then(j => {
      setMonths(Array.isArray(j.months) ? j.months : []);
    }).catch(() => setMonths([]));
    fetch('/api/settlement/product-ads?months=1&platform=toss').then(r => r.json()).then(j => setTossMonths(Array.isArray(j.months) ? j.months : [])).catch(() => setTossMonths([]));
  }, []);
  useEffect(() => { fetch('/api/settlement/product-ads?months=1&platform=toss').then(r => r.json()).then(j => setTossMonths(Array.isArray(j.months) ? j.months : [])).catch(() => setTossMonths([])); }, []);
  /** 토스: raw(toss_ad_rows) 는 이미 DB 에 있으므로 서버에서 월 집계만 다시 만든다 (업로드 때 자동, 여기선 전체 재집계) */
  async function reaggregateToss() {
    setTossBusy(true);
    try {
      const r = await fetch('/api/settlement/product-ads/aggregate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'toss' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(`토스 재집계 실패: ${j.error ?? r.status}`); return; }
      const ms = Object.keys(j.months ?? {}).sort();
      toast.success(`토스 광고 월 집계 ${ms.length}개월 저장 (raw ${fmtNum(j.rawRows ?? 0)}행)`);
      load(); onSaved?.();
    } finally { setTossBusy(false); }
  }
  useEffect(() => { if (!monthsProp) load(); }, [load, monthsProp]);

  // 이 PC 브라우저의 raw 보유 현황 — IndexedDB 전체(수십만 행)를 읽으면 화면이 수 초 멈추므로
  // 마지막 집계 때 남긴 요약(localStorage)만 읽는다. 실제 raw 는 버튼을 눌렀을 때만 읽는다.
  const LOCAL_INFO_KEY = 'lv-erp-settlement-ad-local-info';
  useEffect(() => {
    try { const j = localStorage.getItem(LOCAL_INFO_KEY); if (j) setLocalInfo(JSON.parse(j)); } catch {}
  }, []);

  async function saveFromLocal() {
    setBusy('읽는 중');
    try {
      const rows = await readLocalAdRows();
      if (!rows.length) { toast.warning('이 PC 브라우저에 광고 raw 가 없습니다. 광고 분석 페이지에서 보고서를 먼저 올려 주세요.'); return; }
      const agg = aggregateLocalAdRows(rows);
      const yms = Object.keys(agg).sort();
      // 달별 raw 날짜 수 — 데이터 현황판에서 "며칠치가 있는지" 보여주기 위해
      const dayset = new Map<string, Set<string>>();
      for (const r of rows) { const d = String((r as Record<string, unknown>)['날짜'] ?? '').replace(/\D/g, ''); if (d.length >= 8) { const m = `${d.slice(0, 4)}-${d.slice(4, 6)}`; const s = dayset.get(m) ?? new Set(); s.add(d.slice(0, 8)); dayset.set(m, s); } }
      const daysByMonth = Object.fromEntries([...dayset.entries()].map(([m, s]) => [m, s.size]));
      const info = { rows: rows.length, months: yms, daysByMonth };
      setLocalInfo(info);
      try { localStorage.setItem(LOCAL_INFO_KEY, JSON.stringify(info)); } catch {}
      let saved = 0;
      for (const ym of yms) {
        setBusy(`${ym} 저장 중 (${saved + 1}/${yms.length})`);
        const res = await fetch('/api/monthly-product-ads', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ yearMonth: ym, platform: 'coupang', adType: 'pa', products: agg[ym], resolveSku: true }),
        });
        if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(`${ym} 저장 실패: ${j.error ?? res.status}`); return; }
        saved++;
      }
      toast.success(`${saved}개월 광고 집계 저장 완료 (${fmtNum(rows.length)}행 → 월별 요약)`);
      load();
      onSaved?.();
    } finally {
      setBusy(null);
    }
  }

  const recent = lastMonths(6).reverse();
  const byYm = new Map((months ?? []).map(m => [m.year_month, m]));
  const cur = byYm.get(selectedYm);
  const localHasCur = localInfo?.months.includes(selectedYm);

  return (
    <section className="bg-card rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] px-4 md:px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h3 className="text-[15px] font-bold text-fg flex items-center gap-1.5"><Megaphone className="h-4 w-4 text-info" /> 광고비 raw</h3>
          <p className="text-[12px] text-fg-3 mt-0.5">
            쿠팡 PA 보고서는 <Link href="/ad-analysis" className="text-brand font-semibold hover:underline">광고 분석</Link>에 올리면 이 PC 브라우저에 쌓입니다. 아래 버튼이 그 raw 를 월·옵션ID 요약으로 줄여 DB 에 저장합니다. raw 전체 동기화는 필요 없습니다.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={saveFromLocal} disabled={!!busy} title={localInfo ? `지난 집계 기준 이 PC raw ${fmtNum(localInfo.rows)}행 · ${localInfo.months[0] ?? ''}~${localInfo.months[localInfo.months.length - 1] ?? ''}` : '이 PC 브라우저의 광고 raw 를 읽어 월별로 집계합니다 (몇 초 걸림)'}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ?? '이 PC 광고 raw → 월 집계 저장'}
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        {recent.map(ym => {
          const m = byYm.get(ym);
          const sel = ym === selectedYm;
          const local = localInfo?.months.includes(ym);
          return (
            <span key={ym} title={m ? `DB 요약 ${fmtNum(m.rows_count)}건 · 광고비 ${fmtNum(m.cost)}원` : local ? '이 PC 에만 있음 — 위 버튼으로 저장' : '데이터 없음'}
              className={cn('h-7 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border',
                m ? 'bg-success/10 text-success border-success/20' : local ? 'bg-warn/10 text-warn border-warn/20' : 'bg-app text-fg-4 border-transparent',
                sel && 'ring-2 ring-brand/30')}>
              {ym.slice(2).replace('-', '.')}{m ? ' ✓' : local ? ' PC' : ''}
            </span>
          );
        })}
        <span className="text-[11px] text-fg-4 ml-1">✓ DB 저장됨 · PC 이 브라우저에만 있음</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold text-fg-3 w-8">토스</span>
        {recent.map(ym => { const m = (tossMonths ?? []).find(x => x.year_month === ym); const sel = ym === selectedYm;
          return <span key={ym} title={m ? `월 집계 ${fmtNum(m.rows_count)}건 · 광고비 ${fmtNum(m.cost)}원` : '집계 없음 — 광고 분석 > 토스에 보고서를 올리면 자동 집계'}
            className={cn('h-7 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border', m ? 'bg-success/10 text-success border-success/20' : 'bg-app text-fg-4 border-transparent', sel && 'ring-2 ring-brand/30')}>{ym.slice(2).replace('-', '.')}{m ? ' ✓' : ''}</span>; })}
        <button onClick={reaggregateToss} disabled={tossBusy} className="ml-1 text-[11px] text-brand hover:underline disabled:opacity-50 flex items-center gap-1" title="DB 의 토스 raw 전체를 월별로 다시 집계합니다 (마스터 매칭을 고친 뒤에도 누르세요)">{tossBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 토스 raw → 월 집계 재저장</button>
        <span className="text-[11px] text-fg-4">토스 raw 는 <Link href="/ad-analysis/toss" className="text-brand hover:underline">광고 분석 › 토스</Link>에 올리면 DB 에 저장되고 그 달이 자동 집계됩니다.</span>
      </div>
      {months && months.length > 0 && !cur ? (
        <p className="mt-2 text-[11px] text-warn">{selectedYm.replace('-', '.')} 광고 집계가 DB 에 없습니다.{localHasCur ? ' 이 PC 에 raw 가 있으니 위 버튼을 누르면 저장됩니다.' : ' 광고 분석에 해당 월 보고서를 먼저 올려 주세요.'}</p>
      ) : cur ? (
        <p className="mt-2 text-[11px] text-fg-4">{selectedYm.replace('-', '.')} 광고비 합계 {fmtNum(cur.cost)}원 · 옵션 {fmtNum(cur.rows_count)}개. 시트의 광고비 칸과 비교해 라이브·메시지 등 raw 에 없는 광고가 있는지 확인하세요.</p>
      ) : null}
    </section>
  );
}
